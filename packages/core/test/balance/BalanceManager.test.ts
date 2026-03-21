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

  it('handles adapter missing from map gracefully', async () => {
    // Create an adapters map, then query chains that include one without an adapter
    const adapters = new Map<ChainId, ChainAdapter>([
      ['base', makeAdapter('base', 5000000n)],
    ]);
    // Manually add a chainId key with undefined adapter to simulate the gap
    (adapters as Map<ChainId, ChainAdapter>).set('polygon', undefined as unknown as ChainAdapter);

    const manager = new BalanceManager({ adapters });
    const balances = await manager.getBalances('0xUser', 'USDC');

    // base should succeed, polygon should be skipped (adapter undefined)
    expect(balances.has('base')).toBe(true);
  });

  it('times out hanging balance queries instead of blocking forever', async () => {
    // Use real timers for this test since it relies on actual setTimeout
    vi.useRealTimers();

    const hangingAdapter: ChainAdapter = {
      chainId: 'polygon' as ChainId,
      async getBalance(): Promise<TokenBalance> {
        // Simulate a hanging RPC — never resolves
        return new Promise(() => {});
      },
      async estimateFee() { return { chainId: 'polygon' as ChainId, feeAmount: 0n, feeUsd: 0n, finalityMs: 0, confidence: 'high' as const, timestamp: 0 }; },
      async buildPaymentPayload(p) { return { chainId: 'polygon' as ChainId, to: p.payTo, amount: p.amount, token: p.token, data: '0x' }; },
      getFinality() { return 2000; },
    };

    const adapters = new Map<ChainId, ChainAdapter>([
      ['base', makeAdapter('base', 5000000n)],
      ['polygon', hangingAdapter],
    ]);

    const manager = new BalanceManager({ adapters, queryTimeoutMs: 100 });

    const start = Date.now();
    const balances = await manager.getBalances('0xUser', 'USDC');
    const elapsed = Date.now() - start;

    // Should complete within timeout (~100ms), not hang
    expect(elapsed).toBeLessThan(2000);
    // Base succeeded, polygon timed out
    expect(balances.get('base')).toBe(5000000n);
    expect(balances.has('polygon')).toBe(false);

    // Restore fake timers for remaining tests
    vi.useFakeTimers();
  });

  it('evicts oldest cache entries when max size exceeded', async () => {
    const adapters = new Map<ChainId, ChainAdapter>([
      ['base', makeAdapter('base', 5000000n)],
    ]);

    // maxCacheEntries = 2 to force eviction
    const manager = new BalanceManager({ adapters, maxCacheEntries: 2 });

    // Fill cache with 3 different address queries
    await manager.getBalances('0xAddr1', 'USDC');
    await manager.getBalances('0xAddr2', 'USDC');
    await manager.getBalances('0xAddr3', 'USDC');

    // Cache should have at most 2 entries (oldest evicted)
    // Verify by clearing and re-querying — if cache was evicted, adapter is called again
    const adapter = adapters.get('base')!;
    const spy = vi.spyOn(adapter, 'getBalance');

    // Addr1 should have been evicted (oldest), so re-query hits adapter
    await manager.getBalances('0xAddr1', 'USDC');
    expect(spy).toHaveBeenCalled();
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
