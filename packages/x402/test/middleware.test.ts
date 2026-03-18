import { describe, it, expect, vi } from 'vitest';
import { routexMiddleware } from '../src/middleware.js';
import type { ParsedX402Response } from '../src/middleware.js';
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
} from '@routexcc/core';
import { RouteExhaustedError } from '@routexcc/core';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeFee(chainId: ChainId, feeUsd?: bigint, finalityMs?: number): FeeEstimate {
  return {
    chainId,
    // BigInt: token amounts must never use floating point
    feeAmount: 1000n,
    feeUsd: feeUsd ?? 500000n,
    finalityMs: finalityMs ?? 2000,
    confidence: 'high',
    timestamp: Date.now(),
  };
}

function makeAdapter(chainId: ChainId, opts?: { balance?: bigint; fail?: boolean }): ChainAdapter {
  // BigInt: token amounts must never use floating point
  const balance = opts?.balance ?? 100_000_000n;
  const fail = opts?.fail ?? false;
  return {
    chainId,
    async getBalance(_address: string, _token: string): Promise<TokenBalance> {
      if (fail) {
        throw new Error('Mock RPC error: connection refused');
      }
      return { chainId, token: 'USDC', balance, timestamp: Date.now() };
    },
    async estimateFee(_payment: AcceptedPayment): Promise<FeeEstimate> {
      if (fail) {
        throw new Error('Mock RPC error: connection refused');
      }
      return makeFee(chainId);
    },
    async buildPaymentPayload(payment: AcceptedPayment, _signer: Signer): Promise<PaymentPayload> {
      if (fail) {
        throw new Error('Mock RPC error: connection refused');
      }
      return {
        chainId,
        to: payment.payTo,
        amount: payment.amount,
        token: payment.token,
        data: `0xSigned_${chainId}`,
      };
    },
    getFinality() {
      return chainId === 'solana' ? 400 : chainId === 'stellar' ? 5000 : 2000;
    },
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

function makeParsed402(chains: AcceptedPayment[]): ParsedX402Response {
  return {
    status: 402,
    paymentRequirement: { acceptedChains: chains },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('routexMiddleware', () => {
  describe('handlePaymentRequired — E2E flow', () => {
    it('routes a 402 response and returns correct chain, amount, recipient', async () => {
      const adapters = new Map<ChainId, ChainAdapter>([
        ['base', makeAdapter('base')],
        ['polygon', makeAdapter('polygon')],
      ]);

      const fees = new Map<ChainId, FeeEstimate>([
        // BigInt: polygon is cheaper
        ['base', makeFee('base', 500000n)],
        ['polygon', makeFee('polygon', 100000n)],
      ]);

      const middleware = routexMiddleware({
        routeConfig: {
          adapters,
          feeOracle: makeFeeOracle(fees),
          strategy: 'cheapest',
          maxFeeAgeMs: 60000,
        },
        signer: mockSigner,
      });

      const parsed = makeParsed402([
        // BigInt: token amounts must never use floating point
        { chainId: 'base', payTo: '0xRecipient', amount: 1000000n, token: 'USDC' },
        { chainId: 'polygon', payTo: '0xRecipient', amount: 1000000n, token: 'USDC' },
      ]);

      const result = await middleware.handlePaymentRequired(parsed);

      // Cheapest chain selected
      expect(result.routeResult.chainId).toBe('polygon');
      expect(result.payload.to).toBe('0xRecipient');
      // BigInt: verify amount
      expect(result.payload.amount).toBe(1000000n);
      expect(result.payload.chainId).toBe('polygon');
      expect(result.payload.data).toBe('0xSigned_polygon');
    });

    it('invokes onRouteSelected callback on success', async () => {
      const onRouteSelected = vi.fn();
      const adapters = new Map<ChainId, ChainAdapter>([['base', makeAdapter('base')]]);
      const fees = new Map<ChainId, FeeEstimate>([['base', makeFee('base')]]);

      const middleware = routexMiddleware({
        routeConfig: {
          adapters,
          feeOracle: makeFeeOracle(fees),
          strategy: 'cheapest',
          maxFeeAgeMs: 60000,
        },
        signer: mockSigner,
        onRouteSelected,
      });

      const parsed = makeParsed402([
        { chainId: 'base', payTo: '0xRecipient', amount: 1000000n, token: 'USDC' },
      ]);

      await middleware.handlePaymentRequired(parsed);
      expect(onRouteSelected).toHaveBeenCalledOnce();
      expect(onRouteSelected.mock.calls[0]![0]).toHaveProperty('chainId', 'base');
    });
  });

  describe('multi-chain — cheapest selected', () => {
    it('selects cheapest from 4 available chains', async () => {
      const adapters = new Map<ChainId, ChainAdapter>([
        ['base', makeAdapter('base')],
        ['polygon', makeAdapter('polygon')],
        ['stellar', makeAdapter('stellar')],
        ['solana', makeAdapter('solana')],
      ]);

      const fees = new Map<ChainId, FeeEstimate>([
        // BigInt: solana is cheapest
        ['base', makeFee('base', 500000n)],
        ['polygon', makeFee('polygon', 400000n)],
        ['stellar', makeFee('stellar', 300000n)],
        ['solana', makeFee('solana', 50000n)],
      ]);

      const middleware = routexMiddleware({
        routeConfig: {
          adapters,
          feeOracle: makeFeeOracle(fees),
          strategy: 'cheapest',
          maxFeeAgeMs: 60000,
        },
        signer: mockSigner,
      });

      const parsed = makeParsed402([
        { chainId: 'base', payTo: '0xR', amount: 1000000n, token: 'USDC' },
        { chainId: 'polygon', payTo: '0xR', amount: 1000000n, token: 'USDC' },
        { chainId: 'stellar', payTo: 'GR', amount: 1000000n, token: 'USDC' },
        { chainId: 'solana', payTo: 'SR', amount: 1000000n, token: 'USDC' },
      ]);

      const result = await middleware.handlePaymentRequired(parsed);
      expect(result.routeResult.chainId).toBe('solana');
      expect(result.routeResult.evaluatedOptions).toHaveLength(4);
    });
  });

  describe('constraints — chains excluded', () => {
    it('excludes 2 chains, evaluates remaining', async () => {
      const adapters = new Map<ChainId, ChainAdapter>([
        ['base', makeAdapter('base')],
        ['polygon', makeAdapter('polygon')],
        ['stellar', makeAdapter('stellar')],
        ['solana', makeAdapter('solana')],
      ]);

      const fees = new Map<ChainId, FeeEstimate>([
        ['base', makeFee('base', 500000n)],
        ['polygon', makeFee('polygon', 100000n)],
        ['stellar', makeFee('stellar', 200000n)],
        ['solana', makeFee('solana', 50000n)],
      ]);

      const middleware = routexMiddleware({
        routeConfig: {
          adapters,
          feeOracle: makeFeeOracle(fees),
          strategy: 'cheapest',
          maxFeeAgeMs: 60000,
          // Exclude the two cheapest
          excludeChains: ['solana', 'polygon'],
        },
        signer: mockSigner,
      });

      const parsed = makeParsed402([
        { chainId: 'base', payTo: '0xR', amount: 1000000n, token: 'USDC' },
        { chainId: 'polygon', payTo: '0xR', amount: 1000000n, token: 'USDC' },
        { chainId: 'stellar', payTo: 'GR', amount: 1000000n, token: 'USDC' },
        { chainId: 'solana', payTo: 'SR', amount: 1000000n, token: 'USDC' },
      ]);

      const result = await middleware.handlePaymentRequired(parsed);
      // Solana and polygon excluded → stellar is cheapest remaining
      expect(result.routeResult.chainId).toBe('stellar');
    });
  });

  describe('fallback — all ineligible', () => {
    it('throws RouteExhaustedError when all chains have insufficient balance', async () => {
      const adapters = new Map<ChainId, ChainAdapter>([
        // BigInt: zero balance means insufficient
        ['base', makeAdapter('base', { balance: 0n })],
        ['polygon', makeAdapter('polygon', { balance: 0n })],
      ]);

      const fees = new Map<ChainId, FeeEstimate>([
        ['base', makeFee('base')],
        ['polygon', makeFee('polygon')],
      ]);

      const middleware = routexMiddleware({
        routeConfig: {
          adapters,
          feeOracle: makeFeeOracle(fees),
          strategy: 'cheapest',
          maxFeeAgeMs: 60000,
        },
        signer: mockSigner,
      });

      const parsed = makeParsed402([
        { chainId: 'base', payTo: '0xR', amount: 1000000n, token: 'USDC' },
        { chainId: 'polygon', payTo: '0xR', amount: 1000000n, token: 'USDC' },
      ]);

      // INV-5: RouteExhaustedError with rejection reasons — caller can direct-pay
      await expect(middleware.handlePaymentRequired(parsed)).rejects.toThrow(RouteExhaustedError);
    });
  });

  describe('degradation — RPC failure mid-route', () => {
    it('throws a graceful error when adapters fail, not a crash', async () => {
      const adapters = new Map<ChainId, ChainAdapter>([
        ['base', makeAdapter('base', { fail: true })],
      ]);

      const fees = new Map<ChainId, FeeEstimate>([
        ['base', makeFee('base')],
      ]);

      const middleware = routexMiddleware({
        routeConfig: {
          adapters,
          feeOracle: makeFeeOracle(fees),
          strategy: 'cheapest',
          maxFeeAgeMs: 60000,
        },
        signer: mockSigner,
      });

      const parsed = makeParsed402([
        { chainId: 'base', payTo: '0xR', amount: 1000000n, token: 'USDC' },
      ]);

      // INV-10: Graceful error propagation, not unhandled crash
      await expect(middleware.handlePaymentRequired(parsed)).rejects.toThrow();
    });
  });

  describe('parseResponse', () => {
    it('returns undefined for non-402 status', () => {
      const adapters = new Map<ChainId, ChainAdapter>([['base', makeAdapter('base')]]);
      const fees = new Map<ChainId, FeeEstimate>([['base', makeFee('base')]]);

      const middleware = routexMiddleware({
        routeConfig: {
          adapters,
          feeOracle: makeFeeOracle(fees),
          strategy: 'cheapest',
          maxFeeAgeMs: 60000,
        },
        signer: mockSigner,
      });

      expect(middleware.parseResponse(200, {})).toBeUndefined();
      expect(middleware.parseResponse(404, {})).toBeUndefined();
      expect(middleware.parseResponse(500, {})).toBeUndefined();
    });

    it('parses a valid 402 response body with acceptedChains', () => {
      const adapters = new Map<ChainId, ChainAdapter>([['base', makeAdapter('base')]]);
      const fees = new Map<ChainId, FeeEstimate>([['base', makeFee('base')]]);

      const middleware = routexMiddleware({
        routeConfig: {
          adapters,
          feeOracle: makeFeeOracle(fees),
          strategy: 'cheapest',
          maxFeeAgeMs: 60000,
        },
        signer: mockSigner,
      });

      const body = {
        acceptedChains: [
          { chainId: 'base', payTo: '0xRecipient', amount: '1000000', token: 'USDC' },
        ],
      };

      const parsed = middleware.parseResponse(402, body);
      expect(parsed).toBeDefined();
      expect(parsed!.status).toBe(402);
      expect(parsed!.paymentRequirement.acceptedChains).toHaveLength(1);
      // BigInt: string amount parsed to bigint
      expect(parsed!.paymentRequirement.acceptedChains[0]!.amount).toBe(1000000n);
    });

    it('parses a nested paymentRequirement object', () => {
      const adapters = new Map<ChainId, ChainAdapter>([['base', makeAdapter('base')]]);
      const fees = new Map<ChainId, FeeEstimate>([['base', makeFee('base')]]);

      const middleware = routexMiddleware({
        routeConfig: {
          adapters,
          feeOracle: makeFeeOracle(fees),
          strategy: 'cheapest',
          maxFeeAgeMs: 60000,
        },
        signer: mockSigner,
      });

      const body = {
        paymentRequirement: {
          acceptedChains: [
            { chainId: 'polygon', payTo: '0xR', amount: 5000000, token: 'USDC' },
          ],
        },
      };

      const parsed = middleware.parseResponse(402, body);
      expect(parsed).toBeDefined();
      // BigInt: integer number parsed to bigint
      expect(parsed!.paymentRequirement.acceptedChains[0]!.amount).toBe(5000000n);
    });

    it('returns undefined for malformed body', () => {
      const adapters = new Map<ChainId, ChainAdapter>([['base', makeAdapter('base')]]);
      const fees = new Map<ChainId, FeeEstimate>([['base', makeFee('base')]]);

      const middleware = routexMiddleware({
        routeConfig: {
          adapters,
          feeOracle: makeFeeOracle(fees),
          strategy: 'cheapest',
          maxFeeAgeMs: 60000,
        },
        signer: mockSigner,
      });

      expect(middleware.parseResponse(402, {})).toBeUndefined();
      expect(middleware.parseResponse(402, { acceptedChains: [] })).toBeUndefined();
      expect(
        middleware.parseResponse(
          402,
          { acceptedChains: 'invalid' } as Record<string, unknown>,
        ),
      ).toBeUndefined();
    });

    it('parses bigint amount and optional extra metadata when present', () => {
      const adapters = new Map<ChainId, ChainAdapter>([['base', makeAdapter('base')]]);
      const fees = new Map<ChainId, FeeEstimate>([['base', makeFee('base')]]);

      const middleware = routexMiddleware({
        routeConfig: {
          adapters,
          feeOracle: makeFeeOracle(fees),
          strategy: 'cheapest',
          maxFeeAgeMs: 60000,
        },
        signer: mockSigner,
      });

      const parsed = middleware.parseResponse(402, {
        acceptedChains: [
          {
            chainId: 'base',
            payTo: '0xRecipient',
            amount: 123n,
            token: 'USDC',
            extra: { memo: 'invoice-42' },
          },
        ],
      });

      expect(parsed).toBeDefined();
      expect(parsed!.paymentRequirement.acceptedChains[0]).toEqual({
        chainId: 'base',
        payTo: '0xRecipient',
        amount: 123n,
        token: 'USDC',
        extra: { memo: 'invoice-42' },
      });
    });

    it('returns undefined when all entries are invalid after validation', () => {
      const adapters = new Map<ChainId, ChainAdapter>([['base', makeAdapter('base')]]);
      const fees = new Map<ChainId, FeeEstimate>([['base', makeFee('base')]]);

      const middleware = routexMiddleware({
        routeConfig: {
          adapters,
          feeOracle: makeFeeOracle(fees),
          strategy: 'cheapest',
          maxFeeAgeMs: 60000,
        },
        signer: mockSigner,
      });

      const parsed = middleware.parseResponse(402, {
        acceptedChains: [
          null,
          1,
          { chainId: 'base', payTo: '0xRecipient', amount: 'not-a-bigint', token: 'USDC' },
          { chainId: 'base', payTo: '0xRecipient', amount: 1.5, token: 'USDC' },
          { chainId: 'base', payTo: 123, amount: 10, token: 'USDC' },
        ],
      } as Record<string, unknown>);

      expect(parsed).toBeUndefined();
    });

    it('skips malformed entries but keeps valid ones in mixed arrays', () => {
      const adapters = new Map<ChainId, ChainAdapter>([['base', makeAdapter('base')]]);
      const fees = new Map<ChainId, FeeEstimate>([['base', makeFee('base')]]);

      const middleware = routexMiddleware({
        routeConfig: {
          adapters,
          feeOracle: makeFeeOracle(fees),
          strategy: 'cheapest',
          maxFeeAgeMs: 60000,
        },
        signer: mockSigner,
      });

      const parsed = middleware.parseResponse(402, {
        acceptedChains: [
          { chainId: 'base', payTo: '0xRecipient', amount: 1000, token: 'USDC' },
          { chainId: 'base', payTo: '0xRecipient', amount: true, token: 'USDC' },
          { payTo: '0xRecipient', amount: 1000, token: 'USDC' },
          { chainId: 'base', payTo: '0xRecipient', amount: '1001', token: 'USDC' },
        ],
      } as Record<string, unknown>);

      expect(parsed).toBeDefined();
      expect(parsed!.paymentRequirement.acceptedChains).toEqual([
        { chainId: 'base', payTo: '0xRecipient', amount: 1000n, token: 'USDC' },
        { chainId: 'base', payTo: '0xRecipient', amount: 1001n, token: 'USDC' },
      ]);
    });
  });
});
