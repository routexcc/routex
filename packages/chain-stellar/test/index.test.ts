import { describe, it, expect } from 'vitest';
import {
  createMockSigner,
  createMockStellarServer,
  ADDRESSES,
  STELLAR_PAYMENT,
} from '@routexcc/test-utils';
import { PaymentConstructionError, type AcceptedPayment, type Signer } from '@routexcc/core';
import {
  StellarAdapter,
  STELLAR_FINALITY_MS,
  DEFAULT_USDC_ISSUER,
  type StellarRpcClient,
} from '../src/index.js';

const PAYMENT: AcceptedPayment = {
  ...STELLAR_PAYMENT,
  amount: 12_345_678n,
};

describe('@routexcc/chain-stellar', () => {
  it('exports adapter class and constants', () => {
    expect(typeof StellarAdapter).toBe('function');
    expect(STELLAR_FINALITY_MS).toBe(5000);
    expect(DEFAULT_USDC_ISSUER.startsWith('G')).toBe(true);
  });

  it('hardcodes Stellar chain identifier', () => {
    const adapter = new StellarAdapter({
      rpcClient: createMockStellarServer(),
      xlmPriceUsd: 100_000_000n,
    });

    expect(adapter.chainId).toBe('stellar');
  });

  it('reads USDC trustline balance and normalizes to 6 decimals', async () => {
    const adapter = new StellarAdapter({
      rpcClient: createMockStellarServer({ balance: '123.4567890' }),
      xlmPriceUsd: 100_000_000n,
    });

    const balance = await adapter.getBalance(ADDRESSES.stellarSender, STELLAR_PAYMENT.token);

    expect(balance.chainId).toBe('stellar');
    expect(balance.balance).toBe(123_456_789n);
  });

  it('returns zero when USDC trustline is missing', async () => {
    const rpcClient: StellarRpcClient = {
      async getAccount(_accountId: string) {
        return {
          balances: [{ asset_type: 'native', balance: '1.0000000' }],
        };
      },
      async getFeeStats() {
        return {
          fee_charged: { p50: '100' },
          last_ledger_base_fee: '100',
        };
      },
    };

    const adapter = new StellarAdapter({
      rpcClient,
      xlmPriceUsd: 100_000_000n,
    });

    const balance = await adapter.getBalance(ADDRESSES.stellarSender, STELLAR_PAYMENT.token);
    expect(balance.balance).toBe(0n);
  });

  it('estimates fee from fee_stats response', async () => {
    const adapter = new StellarAdapter({
      rpcClient: createMockStellarServer({ p50Fee: '250' }),
      xlmPriceUsd: 200_000_000n,
    });

    const fee = await adapter.estimateFee(PAYMENT);
    expect(fee.chainId).toBe('stellar');
    expect(fee.feeAmount).toBe(250n);
    expect(fee.feeUsd).toBe(5_000n);
    expect(fee.finalityMs).toBe(STELLAR_FINALITY_MS);
  });

  it('builds payload preserving recipient and amount', async () => {
    const adapter = new StellarAdapter({
      rpcClient: createMockStellarServer(),
      xlmPriceUsd: 100_000_000n,
    });

    const payload = await adapter.buildPaymentPayload(PAYMENT, createMockSigner());

    expect(payload.chainId).toBe('stellar');
    expect(payload.to).toBe(PAYMENT.payTo);
    expect(payload.amount).toBe(PAYMENT.amount);
    expect(typeof payload.data).toBe('string');
    const decoded = JSON.parse(payload.data) as Record<string, unknown>;
    expect(typeof decoded.envelope).toBe('string');
  });

  it('wraps signer failures as PaymentConstructionError', async () => {
    const adapter = new StellarAdapter({
      rpcClient: createMockStellarServer(),
      xlmPriceUsd: 100_000_000n,
    });
    const failingSigner: Signer = createMockSigner({ behavior: 'error' });

    await expect(adapter.buildPaymentPayload(PAYMENT, failingSigner)).rejects.toBeInstanceOf(
      PaymentConstructionError,
    );
  });

  it('maps non-Error signer failures to Unknown signing error', async () => {
    const adapter = new StellarAdapter({
      rpcClient: createMockStellarServer(),
      xlmPriceUsd: 100_000_000n,
    });
    const failingSigner: Signer = {
      ...createMockSigner(),
      async sign(_data: Uint8Array): Promise<Uint8Array> {
        throw 'raw-failure';
      },
    };

    await expect(adapter.buildPaymentPayload(PAYMENT, failingSigner)).rejects.toThrow(
      'Unknown signing error',
    );
  });

  it('mock RPC timeout propagates as an error (no crash)', async () => {
    const adapter = new StellarAdapter({
      rpcClient: createMockStellarServer({ behavior: 'timeout', timeoutMs: 1 }),
      xlmPriceUsd: 100_000_000n,
    });

    await expect(adapter.getBalance(ADDRESSES.stellarSender, STELLAR_PAYMENT.token)).rejects.toThrow(
      /timeout/i,
    );
  });

  it('mock RPC 500/error propagates as an error (no crash)', async () => {
    const adapter = new StellarAdapter({
      rpcClient: createMockStellarServer({ behavior: 'error' }),
      xlmPriceUsd: 100_000_000n,
    });

    await expect(adapter.estimateFee(PAYMENT)).rejects.toThrow(/rpc error/i);
  });

  it('malformed RPC response propagates as an error (no crash)', async () => {
    const malformedRpc: StellarRpcClient = {
      async getAccount(_accountId: string) {
        return { balances: [] };
      },
      async getFeeStats() {
        return {
          fee_charged: { p50: 'NOT_A_NUMBER' },
          last_ledger_base_fee: '100',
        };
      },
    };

    const adapter = new StellarAdapter({
      rpcClient: malformedRpc,
      xlmPriceUsd: 100_000_000n,
    });

    await expect(adapter.estimateFee(PAYMENT)).rejects.toThrow();
  });

  it('returns configured finality', () => {
    const adapter = new StellarAdapter({
      rpcClient: createMockStellarServer(),
      xlmPriceUsd: 100_000_000n,
    });

    expect(adapter.getFinality()).toBe(STELLAR_FINALITY_MS);
  });
});
