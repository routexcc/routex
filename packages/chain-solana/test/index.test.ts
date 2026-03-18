import { describe, it, expect } from 'vitest';
import {
  createMockSigner,
  createMockSolanaConnection,
  ADDRESSES,
  SOLANA_PAYMENT,
} from '@routexcc/test-utils';
import { PaymentConstructionError, type AcceptedPayment, type Signer } from '@routexcc/core';
import {
  SolanaAdapter,
  SOLANA_FINALITY_MS,
  BASE_FEE_LAMPORTS,
  type SolanaRpcClient,
} from '../src/index.js';

const PAYMENT: AcceptedPayment = {
  ...SOLANA_PAYMENT,
  amount: 9_001n,
};

describe('@routexcc/chain-solana', () => {
  it('exports adapter class and constants', () => {
    expect(typeof SolanaAdapter).toBe('function');
    expect(SOLANA_FINALITY_MS).toBe(400);
    expect(BASE_FEE_LAMPORTS).toBe(5000n);
  });

  it('hardcodes Solana chain identifier', () => {
    const adapter = new SolanaAdapter({
      rpcClient: createMockSolanaConnection(),
      solPriceUsd: 100_000_000n,
    });

    expect(adapter.chainId).toBe('solana');
  });

  it('reads SPL token balance from the first token account', async () => {
    const adapter = new SolanaAdapter({
      rpcClient: createMockSolanaConnection({ balance: '123456789' }),
      solPriceUsd: 100_000_000n,
    });

    const balance = await adapter.getBalance(ADDRESSES.solanaSender, PAYMENT.token);
    expect(balance.chainId).toBe('solana');
    expect(balance.balance).toBe(123_456_789n);
  });

  it('returns zero when no token account exists', async () => {
    const rpcClient: SolanaRpcClient = {
      async getTokenAccountBalance(_address: string) {
        return { value: { amount: '1000', decimals: 6 } };
      },
      async getTokenAccountsByOwner(
        _owner: string,
        _filter: { readonly mint: string },
      ) {
        return { value: [] };
      },
      async getRecentPrioritizationFees() {
        return [{ prioritizationFee: 1 }];
      },
    };

    const adapter = new SolanaAdapter({ rpcClient, solPriceUsd: 100_000_000n });
    const balance = await adapter.getBalance(ADDRESSES.solanaSender, PAYMENT.token);

    expect(balance.balance).toBe(0n);
  });

  it('returns zero when token account list has an undefined first entry', async () => {
    const rpcClient: SolanaRpcClient = {
      async getTokenAccountBalance(_address: string) {
        return { value: { amount: '1000', decimals: 6 } };
      },
      async getTokenAccountsByOwner(
        _owner: string,
        _filter: { readonly mint: string },
      ) {
        return {
          value: [undefined as unknown as { readonly pubkey: string }],
        };
      },
      async getRecentPrioritizationFees() {
        return [{ prioritizationFee: 1 }];
      },
    };

    const adapter = new SolanaAdapter({ rpcClient, solPriceUsd: 100_000_000n });
    const balance = await adapter.getBalance(ADDRESSES.solanaSender, PAYMENT.token);

    expect(balance.balance).toBe(0n);
  });

  it('estimates fee using base fee plus median priority fee', async () => {
    const adapter = new SolanaAdapter({
      rpcClient: createMockSolanaConnection({ priorityFees: [10, 30, 20] }),
      solPriceUsd: 100_000_000n,
    });

    const fee = await adapter.estimateFee(PAYMENT);

    expect(fee.chainId).toBe('solana');
    expect(fee.feeAmount).toBe(5_020n);
    expect(fee.feeUsd).toBe(502n);
    expect(fee.finalityMs).toBe(SOLANA_FINALITY_MS);
  });

  it('handles empty priority fee history', async () => {
    const adapter = new SolanaAdapter({
      rpcClient: createMockSolanaConnection({ priorityFees: [] }),
      solPriceUsd: 100_000_000n,
    });

    const fee = await adapter.estimateFee(PAYMENT);
    expect(fee.feeAmount).toBe(BASE_FEE_LAMPORTS);
  });

  it('builds payload preserving recipient and amount', async () => {
    const adapter = new SolanaAdapter({
      rpcClient: createMockSolanaConnection(),
      solPriceUsd: 100_000_000n,
    });

    const payload = await adapter.buildPaymentPayload(PAYMENT, createMockSigner());
    expect(payload.chainId).toBe('solana');
    expect(payload.to).toBe(PAYMENT.payTo);
    expect(payload.amount).toBe(PAYMENT.amount);
    expect(typeof payload.data).toBe('string');
  });

  it('wraps signer failures as PaymentConstructionError', async () => {
    const adapter = new SolanaAdapter({
      rpcClient: createMockSolanaConnection(),
      solPriceUsd: 100_000_000n,
    });
    const failingSigner: Signer = createMockSigner({ behavior: 'error' });

    await expect(adapter.buildPaymentPayload(PAYMENT, failingSigner)).rejects.toBeInstanceOf(
      PaymentConstructionError,
    );
  });

  it('maps non-Error signer failures to Unknown signing error', async () => {
    const adapter = new SolanaAdapter({
      rpcClient: createMockSolanaConnection(),
      solPriceUsd: 100_000_000n,
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
    const adapter = new SolanaAdapter({
      rpcClient: createMockSolanaConnection({ behavior: 'timeout', timeoutMs: 1 }),
      solPriceUsd: 100_000_000n,
    });

    await expect(adapter.estimateFee(PAYMENT)).rejects.toThrow(/timeout/i);
  });

  it('mock RPC 500/error propagates as an error (no crash)', async () => {
    const adapter = new SolanaAdapter({
      rpcClient: createMockSolanaConnection({ behavior: 'error' }),
      solPriceUsd: 100_000_000n,
    });

    await expect(adapter.getBalance(ADDRESSES.solanaSender, PAYMENT.token)).rejects.toThrow(
      /rpc error/i,
    );
  });

  it('malformed RPC response propagates as an error (no crash)', async () => {
    const malformedRpc: SolanaRpcClient = {
      async getTokenAccountBalance(_address: string) {
        return { value: { amount: '1', decimals: 6 } };
      },
      async getTokenAccountsByOwner(
        _owner: string,
        _filter: { readonly mint: string },
      ) {
        return { value: [{ pubkey: 'token-account' }] };
      },
      async getRecentPrioritizationFees() {
        return [{ prioritizationFee: Number.NaN }];
      },
    };

    const adapter = new SolanaAdapter({
      rpcClient: malformedRpc,
      solPriceUsd: 100_000_000n,
    });

    await expect(adapter.estimateFee(PAYMENT)).rejects.toThrow();
  });

  it('returns configured finality', () => {
    const adapter = new SolanaAdapter({
      rpcClient: createMockSolanaConnection(),
      solPriceUsd: 100_000_000n,
    });

    expect(adapter.getFinality()).toBe(SOLANA_FINALITY_MS);
  });
});
