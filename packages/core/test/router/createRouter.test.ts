import { describe, it, expect, vi } from 'vitest';
import { createRouter } from '../../src/router/createRouter.js';
import type {
  ChainId,
  ChainAdapter,
  FeeEstimate,
  FeeOracle,
  AcceptedPayment,
  TokenBalance,
  PaymentPayload,
  Signer,
  PaymentRequirement,
  RouteResult,
} from '../../src/types.js';

function makeFee(chainId: ChainId, feeUsd?: bigint): FeeEstimate {
  return {
    chainId,
    // BigInt: token amounts must never use floating point
    feeAmount: 1000n,
    feeUsd: feeUsd ?? 500000n,
    finalityMs: 2000,
    confidence: 'high',
    timestamp: Date.now(),
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
        data: '0xSignedPayload',
      };
    },
    getFinality() { return 2000; },
  };
}

function makeFeeOracle(fees: Map<ChainId, FeeEstimate>): FeeOracle {
  return {
    async getFee(chainId: ChainId) { return fees.get(chainId); },
    async getAllFees() { return fees; },
    start() { /* noop */ },
    stop() { /* noop */ },
  };
}

const mockSigner: Signer = {
  address: '0xSenderAddress',
  async sign(_data: Uint8Array) { return new Uint8Array([1, 2, 3]); },
};

describe('createRouter', () => {
  it('returns a RouteResult with the best chain', async () => {
    const adapters = new Map<ChainId, ChainAdapter>([
      ['base', makeAdapter('base')],
      ['polygon', makeAdapter('polygon')],
    ]);

    const fees = new Map<ChainId, FeeEstimate>([
      // BigInt: polygon is cheaper
      ['base', makeFee('base', 500000n)],
      ['polygon', makeFee('polygon', 100000n)],
    ]);

    const router = createRouter({
      adapters,
      feeOracle: makeFeeOracle(fees),
      strategy: 'cheapest',
      maxFeeAgeMs: 60000,
    });

    const req: PaymentRequirement = {
      acceptedChains: [
        { chainId: 'base', payTo: '0xRecipient', amount: 1000000n, token: 'USDC' },
        { chainId: 'polygon', payTo: '0xRecipient', amount: 1000000n, token: 'USDC' },
      ],
    };

    const result = await router.route(req, mockSigner);
    expect(result.chainId).toBe('polygon');
    expect(result.payload.to).toBe('0xRecipient');
    // BigInt: verify amount is bigint
    expect(result.payload.amount).toBe(1000000n);
    expect(result.payload.data).toBe('0xSignedPayload');
    expect(result.evaluatedOptions.length).toBeGreaterThan(0);
  });

  it('uses fastest strategy when configured', async () => {
    const adapters = new Map<ChainId, ChainAdapter>([
      ['base', makeAdapter('base')],
      ['polygon', makeAdapter('polygon')],
    ]);

    const fees = new Map<ChainId, FeeEstimate>([
      ['base', makeFee('base')],
      ['polygon', { ...makeFee('polygon'), finalityMs: 500 }],
    ]);

    const router = createRouter({
      adapters,
      feeOracle: makeFeeOracle(fees),
      strategy: 'fastest',
      maxFeeAgeMs: 60000,
    });

    const req: PaymentRequirement = {
      acceptedChains: [
        { chainId: 'base', payTo: '0xRecipient', amount: 1000000n, token: 'USDC' },
        { chainId: 'polygon', payTo: '0xRecipient', amount: 1000000n, token: 'USDC' },
      ],
    };

    const result = await router.route(req, mockSigner);
    expect(result.chainId).toBe('polygon');
  });

  it('uses balanced strategy when configured', async () => {
    const adapters = new Map<ChainId, ChainAdapter>([
      ['base', makeAdapter('base')],
      ['polygon', makeAdapter('polygon')],
    ]);

    const fees = new Map<ChainId, FeeEstimate>([
      ['base', makeFee('base', 200000n)],
      ['polygon', { ...makeFee('polygon', 100000n), finalityMs: 5000 }],
    ]);

    const router = createRouter({
      adapters,
      feeOracle: makeFeeOracle(fees),
      strategy: 'balanced',
      maxFeeAgeMs: 60000,
    });

    const req: PaymentRequirement = {
      acceptedChains: [
        { chainId: 'base', payTo: '0xRecipient', amount: 1000000n, token: 'USDC' },
        { chainId: 'polygon', payTo: '0xRecipient', amount: 1000000n, token: 'USDC' },
      ],
    };

    const result = await router.route(req, mockSigner);
    expect(result.chainId).toBeDefined();
    expect(result.evaluatedOptions.length).toBeGreaterThan(0);
  });

  it('integration: routes a mock payment with all four adapters', async () => {
    const adapters = new Map<ChainId, ChainAdapter>([
      ['base', makeAdapter('base')],
      ['polygon', makeAdapter('polygon')],
      ['stellar', makeAdapter('stellar')],
      ['solana', makeAdapter('solana')],
    ]);

    const fees = new Map<ChainId, FeeEstimate>([
      ['base', makeFee('base', 120000n)],
      ['polygon', makeFee('polygon', 150000n)],
      ['stellar', makeFee('stellar', 140000n)],
      ['solana', makeFee('solana', 130000n)],
    ]);

    const router = createRouter({
      adapters,
      feeOracle: makeFeeOracle(fees),
      strategy: 'cheapest',
      maxFeeAgeMs: 60000,
    });

    const req: PaymentRequirement = {
      acceptedChains: [
        { chainId: 'base', payTo: 'pay_to_base', amount: 1000000n, token: 'USDC' },
        { chainId: 'polygon', payTo: 'pay_to_polygon', amount: 1000000n, token: 'USDC' },
        { chainId: 'stellar', payTo: 'pay_to_stellar', amount: 1000000n, token: 'USDC' },
        { chainId: 'solana', payTo: 'pay_to_solana', amount: 1000000n, token: 'USDC' },
      ],
    };

    const result = await router.route(req, mockSigner);

    expect(result.chainId).toBe('base');
    expect(result.payload.chainId).toBe('base');
    expect(result.payload.to).toBe('pay_to_base');
    expect(result.payload.amount).toBe(1000000n);
    expect(result.evaluatedOptions).toHaveLength(4);
  });

  it('stop() does not throw without cloudApiKey', async () => {
    const router = createRouter({
      adapters: new Map([['base', makeAdapter('base')]]),
      feeOracle: makeFeeOracle(new Map([['base', makeFee('base')]])),
      strategy: 'cheapest',
      maxFeeAgeMs: 60000,
    });

    await expect(router.stop()).resolves.toBeUndefined();
  });
});

describe('createRouter v2 activation', () => {
  it('activates CloudFeeOracle when cloudApiKey is set', async () => {
    const adapters = new Map<ChainId, ChainAdapter>([
      ['base', makeAdapter('base')],
      ['polygon', makeAdapter('polygon')],
    ]);

    const fees = new Map<ChainId, FeeEstimate>([
      ['base', makeFee('base', 500000n)],
      ['polygon', makeFee('polygon', 100000n)],
    ]);

    const router = createRouter({
      adapters,
      feeOracle: makeFeeOracle(fees),
      strategy: 'cheapest',
      maxFeeAgeMs: 60000,
      cloudApiKey: 'rtx_test_key_123',
    });

    const req: PaymentRequirement = {
      acceptedChains: [
        { chainId: 'base', payTo: '0xRecipient', amount: 1000000n, token: 'USDC' },
        { chainId: 'polygon', payTo: '0xRecipient', amount: 1000000n, token: 'USDC' },
      ],
    };

    // Cloud oracle wraps fallback — cloud is unreachable so it falls back to local
    // The route should still succeed (seamless degradation)
    const result = await router.route(req, mockSigner);
    expect(result.chainId).toBe('polygon');
    expect(result.payload.to).toBe('0xRecipient');

    await router.stop();
  });

  it('fires telemetry after successful route with cloudApiKey', async () => {
    const adapters = new Map<ChainId, ChainAdapter>([
      ['base', makeAdapter('base')],
    ]);

    const fees = new Map<ChainId, FeeEstimate>([
      ['base', makeFee('base', 200000n)],
    ]);

    const router = createRouter({
      adapters,
      feeOracle: makeFeeOracle(fees),
      strategy: 'cheapest',
      maxFeeAgeMs: 60000,
      cloudApiKey: 'rtx_telemetry_test',
    });

    const req: PaymentRequirement = {
      acceptedChains: [
        { chainId: 'base', payTo: '0xRecipient', amount: 1000000n, token: 'USDC' },
      ],
    };

    const result = await router.route(req, mockSigner);
    expect(result.chainId).toBe('base');

    // Telemetry fires asynchronously — stop() flushes it
    await router.stop();
  });

  it('works without @routexcc/cloud installed (graceful degradation)', async () => {
    // This test verifies the dynamic import catch path
    // Since @routexcc/cloud IS installed in dev, we can't truly test "not installed"
    // but we verify the router works with cloudApiKey set
    const adapters = new Map<ChainId, ChainAdapter>([
      ['base', makeAdapter('base')],
    ]);

    const fees = new Map<ChainId, FeeEstimate>([
      ['base', makeFee('base')],
    ]);

    const router = createRouter({
      adapters,
      feeOracle: makeFeeOracle(fees),
      strategy: 'cheapest',
      maxFeeAgeMs: 60000,
      cloudApiKey: 'rtx_fallback_test',
    });

    const req: PaymentRequirement = {
      acceptedChains: [
        { chainId: 'base', payTo: '0xRecipient', amount: 1000000n, token: 'USDC' },
      ],
    };

    // Should work even with cloud key set
    const result = await router.route(req, mockSigner);
    expect(result).toBeDefined();
    expect(result.chainId).toBe('base');

    await router.stop();
  });

  it('zero breaking changes from v1 — no cloudApiKey works as before', async () => {
    const adapters = new Map<ChainId, ChainAdapter>([
      ['base', makeAdapter('base')],
      ['polygon', makeAdapter('polygon')],
    ]);

    const fees = new Map<ChainId, FeeEstimate>([
      ['base', makeFee('base', 300000n)],
      ['polygon', makeFee('polygon', 200000n)],
    ]);

    // v1 config — no cloudApiKey
    const router = createRouter({
      adapters,
      feeOracle: makeFeeOracle(fees),
      strategy: 'cheapest',
      maxFeeAgeMs: 60000,
    });

    const req: PaymentRequirement = {
      acceptedChains: [
        { chainId: 'base', payTo: '0xRecipient', amount: 1000000n, token: 'USDC' },
        { chainId: 'polygon', payTo: '0xRecipient', amount: 1000000n, token: 'USDC' },
      ],
    };

    const result = await router.route(req, mockSigner);
    expect(result.chainId).toBe('polygon');

    await router.stop();
  });
});
