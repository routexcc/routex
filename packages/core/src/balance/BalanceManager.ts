import type { ChainId, ChainAdapter } from '../types.js';

/**
 * Configuration for the BalanceManager.
 */
export interface BalanceManagerConfig {
  /** Chain adapters keyed by chain ID. */
  readonly adapters: ReadonlyMap<ChainId, ChainAdapter>;
  /** Cache TTL in milliseconds (default: 15000). */
  readonly cacheTtlMs?: number;
  /** Maximum cache entries before oldest are evicted (default: 1000). */
  readonly maxCacheEntries?: number;
  /** Timeout for balance queries in milliseconds (default: 10000). */
  readonly queryTimeoutMs?: number;
}

interface CachedBalance {
  readonly balance: bigint;
  readonly timestamp: number;
}

/**
 * Queries balances across all configured chains in parallel via Promise.allSettled.
 * Returns Map<ChainId, bigint> with configurable TTL caching.
 */
export class BalanceManager {
  private readonly adapters: ReadonlyMap<ChainId, ChainAdapter>;
  private readonly cacheTtlMs: number;
  private readonly maxCacheEntries: number;
  private readonly queryTimeoutMs: number;
  private readonly cache = new Map<string, CachedBalance>();

  constructor(config: BalanceManagerConfig) {
    this.adapters = config.adapters;
    this.cacheTtlMs = config.cacheTtlMs ?? 15_000;
    this.maxCacheEntries = config.maxCacheEntries ?? 1000;
    this.queryTimeoutMs = config.queryTimeoutMs ?? 10_000;
  }

  /**
   * Query balances for a given address and token across all chains.
   * Uses Promise.allSettled so a failed chain query doesn't block others.
   */
  async getBalances(address: string, token: string): Promise<ReadonlyMap<ChainId, bigint>> {
    const chainIds = [...this.adapters.keys()];
    const now = Date.now();

    // Check cache and determine which chains need fresh queries
    const result = new Map<ChainId, bigint>();
    const chainsToQuery: ChainId[] = [];

    for (const chainId of chainIds) {
      const cacheKey = `${chainId}:${address}:${token}`;
      const cached = this.cache.get(cacheKey);
      if (cached !== undefined && now - cached.timestamp < this.cacheTtlMs) {
        result.set(chainId, cached.balance);
      } else {
        chainsToQuery.push(chainId);
      }
    }

    if (chainsToQuery.length === 0) {
      return result;
    }

    // Query remaining chains in parallel — failed/timed-out queries don't block others
    const timeoutMs = this.queryTimeoutMs;
    const queries = chainsToQuery.map(async (chainId) => {
      const adapter = this.adapters.get(chainId);
      if (adapter === undefined) {
        return { chainId, balance: undefined };
      }
      const tokenBalance = await adapter.getBalance(address, token);
      return { chainId, balance: tokenBalance.balance };
    });

    // Race each query against a timeout to prevent hanging on unresponsive RPCs
    const withTimeout = queries.map((query) =>
      Promise.race([
        query,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('balance query timeout')), timeoutMs),
        ),
      ]),
    );

    const settled = await Promise.allSettled(withTimeout);

    for (const entry of settled) {
      if (entry.status === 'fulfilled' && entry.value.balance !== undefined) {
        const { chainId, balance } = entry.value;
        result.set(chainId, balance);

        // Update cache
        const cacheKey = `${chainId}:${address}:${token}`;
        this.cache.set(cacheKey, { balance, timestamp: now });
      }
      // Rejected promises are silently skipped — graceful degradation
    }

    // Evict oldest entries if cache exceeds max size
    this.evictIfNeeded();

    return result;
  }

  /** Evict oldest cache entries when max size is exceeded. */
  private evictIfNeeded(): void {
    if (this.cache.size <= this.maxCacheEntries) {
      return;
    }
    // Map iteration order is insertion order — delete oldest entries first
    const toDelete = this.cache.size - this.maxCacheEntries;
    let deleted = 0;
    for (const key of this.cache.keys()) {
      if (deleted >= toDelete) break;
      this.cache.delete(key);
      deleted++;
    }
  }

  /**
   * Clear the balance cache.
   */
  clearCache(): void {
    this.cache.clear();
  }
}
