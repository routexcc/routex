import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RouteSelector } from '../../src/router/RouteSelector.js';
import { createRouter } from '../../src/router/createRouter.js';
import { LocalFeeOracle } from '../../src/oracle/LocalFeeOracle.js';
import { RouteExhaustedError } from '../../src/errors.js';
import type {
  AcceptedPayment,
  ChainAdapter,
  ChainId,
  FeeEstimate,
  FeeOracle,
  PaymentPayload,
  PaymentRequirement,
  RouteConfig,
  Signer,
  TokenBalance,
} from '../../src/types.js';

function makeFee(chainId: ChainId, overrides?: Partial<FeeEstimate>): FeeEstimate {
  return {
    chainId,
    feeAmount: 1_000n,
    feeUsd: 100_000n,
    finalityMs: 2_000,
    confidence: 'high',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeRequirement(payment: AcceptedPayment): PaymentRequirement {
  return { acceptedChains: [payment] };
}

function makeFeeOracle(fees: ReadonlyMap<ChainId, FeeEstimate>): FeeOracle {
  return {
    async getFee(chainId: ChainId): Promise<FeeEstimate | undefined> {
      return fees.get(chainId);
    },
    async getAllFees(): Promise<ReadonlyMap<ChainId, FeeEstimate>> {
      return fees;
    },
    start(): void {
      // noop
    },
    stop(): void {
      // noop
    },
  };
}

function makeAdapter(chainId: ChainId): ChainAdapter {
  return {
    chainId,
    async getBalance(_address: string, token: string): Promise<TokenBalance> {
      return { chainId, token, balance: 10_000_000n, timestamp: Date.now() };
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
      return 2_000;
    },
  };
}

const BASE_PAYMENT: AcceptedPayment = {
  chainId: 'base',
  payTo: '0x2222222222222222222222222222222222222222',
  amount: 1_000_000n,
  token: '0x3333333333333333333333333333333333333333',
};

const MOCK_SIGNER: Signer = {
  address: '0x1111111111111111111111111111111111111111',
  async sign(_data: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array([1, 2, 3]);
  },
  async signTypedData(_typedData: Record<string, unknown>): Promise<string> {
    return '0xsignature';
  },
};

describe('abuse scenarios — section 2.1 routing layer attacks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-17T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('fee oracle manipulation', () => {
    it('rejects stale fee data', async () => {
      const config: RouteConfig = {
        adapters: new Map<ChainId, ChainAdapter>([['base', makeAdapter('base')]]),
        feeOracle: makeFeeOracle(new Map()),
        strategy: 'cheapest',
        maxFeeAgeMs: 60_000,
      };
      const selector = new RouteSelector(config);

      const fees = new Map<ChainId, FeeEstimate>([
        ['base', makeFee('base', { timestamp: Date.now() - 60_001 })],
      ]);
      const balances = new Map<ChainId, bigint>([['base', 10_000_000n]]);

      await expect(selector.select(makeRequirement(BASE_PAYMENT), balances, fees)).rejects.toThrow(
        RouteExhaustedError,
      );
    });

    it('detects RPC compromise by cross-validating divergent fallback data', async () => {
      const primary = new Map<ChainId, ChainAdapter>([
        [
          'base',
          {
            ...makeAdapter('base'),
            async estimateFee(_payment: AcceptedPayment): Promise<FeeEstimate> {
              return makeFee('base', { feeUsd: 100_000n, confidence: 'high' });
            },
          },
        ],
      ]);
      const fallback = new Map<ChainId, ChainAdapter>([
        [
          'base',
          {
            ...makeAdapter('base'),
            async estimateFee(_payment: AcceptedPayment): Promise<FeeEstimate> {
              return makeFee('base', { feeUsd: 210_000n, confidence: 'high' });
            },
          },
        ],
      ]);

      const oracle = new LocalFeeOracle({
        adapters: primary,
        fallbackAdapters: fallback,
        maxFeeAgeMs: 60_000,
        maxDivergencePercent: 50,
      });

      oracle.start();
      await vi.advanceTimersByTimeAsync(0);
      const fee = await oracle.getFee('base');
      oracle.stop();

      expect(fee).toBeDefined();
      expect(fee!.confidence).toBe('low');
    });

    it('marks confidence low when primary and fallback disagree by 50% or more', async () => {
      const primary = new Map<ChainId, ChainAdapter>([
        [
          'base',
          {
            ...makeAdapter('base'),
            async estimateFee(_payment: AcceptedPayment): Promise<FeeEstimate> {
              return makeFee('base', { feeUsd: 100_000n, confidence: 'high' });
            },
          },
        ],
      ]);
      const fallback = new Map<ChainId, ChainAdapter>([
        [
          'base',
          {
            ...makeAdapter('base'),
            async estimateFee(_payment: AcceptedPayment): Promise<FeeEstimate> {
              return makeFee('base', { feeUsd: 200_000n, confidence: 'high' });
            },
          },
        ],
      ]);

      const oracle = new LocalFeeOracle({
        adapters: primary,
        fallbackAdapters: fallback,
        maxFeeAgeMs: 60_000,
        maxDivergencePercent: 50,
      });

      oracle.start();
      await vi.advanceTimersByTimeAsync(0);
      const fee = await oracle.getFee('base');
      oracle.stop();

      expect(fee).toBeDefined();
      expect(fee!.confidence).toBe('low');
    });
  });

  describe('recipient address substitution', () => {
    it('tampered payload recipient is rejected', async () => {
      const tamperedAdapter: ChainAdapter = {
        ...makeAdapter('base'),
        async buildPaymentPayload(payment: AcceptedPayment, _signer: Signer): Promise<PaymentPayload> {
          return {
            chainId: 'base',
            to: '0x9999999999999999999999999999999999999999',
            amount: payment.amount,
            token: payment.token,
            data: '0xtampered',
          };
        },
      };

      const router = createRouter({
        adapters: new Map<ChainId, ChainAdapter>([['base', tamperedAdapter]]),
        feeOracle: makeFeeOracle(new Map<ChainId, FeeEstimate>([['base', makeFee('base')]])),
        strategy: 'cheapest',
        maxFeeAgeMs: 60_000,
      });

      await expect(router.route(makeRequirement(BASE_PAYMENT), MOCK_SIGNER)).rejects.toThrow(
        /recipient mismatch/i,
      );
    });
  });

  describe('amount manipulation', () => {
    it('tampered payload amount fails exact BigInt match', async () => {
      const tamperedAdapter: ChainAdapter = {
        ...makeAdapter('base'),
        async buildPaymentPayload(payment: AcceptedPayment, _signer: Signer): Promise<PaymentPayload> {
          return {
            chainId: 'base',
            to: payment.payTo,
            amount: payment.amount - 1n,
            token: payment.token,
            data: '0xtampered',
          };
        },
      };

      const router = createRouter({
        adapters: new Map<ChainId, ChainAdapter>([['base', tamperedAdapter]]),
        feeOracle: makeFeeOracle(new Map<ChainId, FeeEstimate>([['base', makeFee('base')]])),
        strategy: 'cheapest',
        maxFeeAgeMs: 60_000,
      });

      await expect(router.route(makeRequirement(BASE_PAYMENT), MOCK_SIGNER)).rejects.toThrow(
        /amount mismatch/i,
      );
    });

    it('rejects truncation attacks and requires exact bigint amount', async () => {
      const requiredAmount = 1_999_900n; // 1.9999 USDC with 6 decimals
      const payment: AcceptedPayment = {
        ...BASE_PAYMENT,
        amount: requiredAmount,
      };

      const tamperedAdapter: ChainAdapter = {
        ...makeAdapter('base'),
        async buildPaymentPayload(
          _payment: AcceptedPayment,
          _signer: Signer,
        ): Promise<PaymentPayload> {
          return {
            chainId: 'base',
            to: payment.payTo,
            amount: 1_000_000n,
            token: payment.token,
            data: '0xtruncated',
          };
        },
      };

      const router = createRouter({
        adapters: new Map<ChainId, ChainAdapter>([['base', tamperedAdapter]]),
        feeOracle: makeFeeOracle(new Map<ChainId, FeeEstimate>([['base', makeFee('base')]])),
        strategy: 'cheapest',
        maxFeeAgeMs: 60_000,
      });

      await expect(router.route(makeRequirement(payment), MOCK_SIGNER)).rejects.toThrow(
        /amount mismatch/i,
      );
    });
  });

  describe('chain ID spoofing', () => {
    it('tampered payload chain ID is rejected', async () => {
      const tamperedAdapter: ChainAdapter = {
        ...makeAdapter('base'),
        async buildPaymentPayload(payment: AcceptedPayment, _signer: Signer): Promise<PaymentPayload> {
          return {
            chainId: 'polygon',
            to: payment.payTo,
            amount: payment.amount,
            token: payment.token,
            data: '0xspoofed-chain-id',
          };
        },
      };

      const router = createRouter({
        adapters: new Map<ChainId, ChainAdapter>([['base', tamperedAdapter]]),
        feeOracle: makeFeeOracle(new Map<ChainId, FeeEstimate>([['base', makeFee('base')]])),
        strategy: 'cheapest',
        maxFeeAgeMs: 60_000,
      });

      await expect(router.route(makeRequirement(BASE_PAYMENT), MOCK_SIGNER)).rejects.toThrow(
        /chain id mismatch/i,
      );
    });
  });
});
