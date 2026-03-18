import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BalanceManager } from '../../src/balance/BalanceManager.js';
import type { ChainId, ChainAdapter, FeeEstimate, AcceptedPayment, TokenBalance, PaymentPayload, Signer } from '../../src/types.js';

function makeAdapter(
  chainId: ChainId,
  balance?: bigint,
  shouldFail?: boolean,
): ChainAdapter {
  return {
    chainId,
    async getBalance(_address: string, _token: string): Promise<TokenBalance> {
      if (shouldFail) {
        throw new Error('RPC failed');
      }
      return {
        chainId,
        token: 'USDC',
        // BigInt: token amounts must never use floating point
        balance: balance ?? 10000000n,
        timestamp: Date.now(),
      };
    },
    async estimateFee(_payment: AcceptedPayment): Promise<FeeEstimate> {
      return {
        chainId,
        feeAmount: 1000n,
        feeUsd: 500000n,
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

describe('BalanceManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('queries balances across all chains in parallel', async () => {
    const adapters = new Map<ChainId, ChainAdapter>([
      // BigInt: different balances per chain
      ['base', makeAdapter('base', 5000000n)],
      ['polygon', makeAdapter('polygon', 8000000n)],
    ]);

    const manager = new BalanceManager({ adapters });
    const balances = await manager.getBalances('0xUser', 'USDC');

    expect(balances.size).toBe(2);
    // BigInt: verify values are bigint
    expect(balances.get('base')).toBe(5000000n);
    expect(balances.get('polygon')).toBe(8000000n);
  });

  it('returns cached balances within TTL', async () => {
    const adapter = makeAdapter('base', 5000000n);
    const spy = vi.spyOn(adapter, 'getBalance');

    const adapters = new Map<ChainId, ChainAdapter>([['base', adapter]]);
    const manager = new BalanceManager({ adapters, cacheTtlMs: 15000 });

    // First query
    await manager.getBalances('0xUser', 'USDC');
    expect(spy).toHaveBeenCalledTimes(1);

    // Second query within TTL — should use cache
    await manager.getBalances('0xUser', 'USDC');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('refreshes cache after TTL expires', async () => {
    const adapter = makeAdapter('base', 5000000n);
    const spy = vi.spyOn(adapter, 'getBalance');

    const adapters = new Map<ChainId, ChainAdapter>([['base', adapter]]);
    const manager = new BalanceManager({ adapters, cacheTtlMs: 5000 });

    await manager.getBalances('0xUser', 'USDC');
    expect(spy).toHaveBeenCalledTimes(1);

    // Advance past TTL
    vi.advanceTimersByTime(6000);

    await manager.getBalances('0xUser', 'USDC');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('gracefully handles failed chain queries', async () => {
    const adapters = new Map<ChainId, ChainAdapter>([
      ['base', makeAdapter('base', 5000000n)],
      ['polygon', makeAdapter('polygon', undefined, true)], // fails
    ]);

    const manager = new BalanceManager({ adapters });
    const balances = await manager.getBalances('0xUser', 'USDC');

    // Only base succeeds
    expect(balances.size).toBe(1);
    // BigInt: verify balance
    expect(balances.get('base')).toBe(5000000n);
    expect(balances.has('polygon')).toBe(false);
  });

  it('clearCache forces fresh queries', async () => {
    const adapter = makeAdapter('base', 5000000n);
    const spy = vi.spyOn(adapter, 'getBalance');

    const adapters = new Map<ChainId, ChainAdapter>([['base', adapter]]);
    const manager = new BalanceManager({ adapters, cacheTtlMs: 60000 });

    await manager.getBalances('0xUser', 'USDC');
    expect(spy).toHaveBeenCalledTimes(1);

    manager.clearCache();

    await manager.getBalances('0xUser', 'USDC');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('all balances are bigint', async () => {
    const adapters = new Map<ChainId, ChainAdapter>([
      // BigInt: large balance value
      ['base', makeAdapter('base', 999999999999999999n)],
    ]);

    const manager = new BalanceManager({ adapters });
    const balances = await manager.getBalances('0xUser', 'USDC');

    // BigInt: verify type
    expect(typeof balances.get('base')).toBe('bigint');
  });
});
