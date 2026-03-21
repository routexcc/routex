import type { ChainId, FeeEstimate, FeeOracle, ChainAdapter } from '../types.js';

// Declare timer globals that exist in both Node.js and browser runtimes
// but are not included in the ES2022 lib
declare function setInterval(callback: () => void, ms: number): number;
declare function clearInterval(handle: number): void;

/**
 * Configuration for the LocalFeeOracle.
 */
export interface LocalFeeOracleConfig {
  /** Chain adapters to poll for fee estimates. */
  readonly adapters: ReadonlyMap<ChainId, ChainAdapter>;
  /** Polling interval in milliseconds (default: 30000). */
  readonly pollIntervalMs?: number;
  /** Maximum age of fee estimates in milliseconds before confidence degrades. */
  readonly maxFeeAgeMs: number;
  /** Optional fallback adapters for cross-validation. */
  readonly fallbackAdapters?: ReadonlyMap<ChainId, ChainAdapter>;
  /** Maximum percentage divergence between primary and fallback before confidence degrades. */
  readonly maxDivergencePercent?: number;
}

/**
 * Local fee oracle that polls chain adapters for fee estimates.
 *
 * - Polls each chain at a configurable interval (default 30s)
 * - In-memory cache with stale detection
 * - Multi-RPC fallback: tries primary then fallback adapter
 * - Cross-validation: if primary and fallback disagree by >50%, confidence: 'low'
 */
export class LocalFeeOracle implements FeeOracle {
  private readonly cache = new Map<ChainId, FeeEstimate>();
  private readonly adapters: ReadonlyMap<ChainId, ChainAdapter>;
  private readonly fallbackAdapters: ReadonlyMap<ChainId, ChainAdapter>;
  private readonly pollIntervalMs: number;
  private readonly maxFeeAgeMs: number;
  private readonly maxDivergencePercent: number;
  private timers: Map<ChainId, number> = new Map();
  private started = false;

  constructor(config: LocalFeeOracleConfig) {
    this.adapters = config.adapters;
    this.fallbackAdapters = config.fallbackAdapters ?? new Map();
    this.pollIntervalMs = config.pollIntervalMs ?? 30_000;
    this.maxFeeAgeMs = config.maxFeeAgeMs;
    this.maxDivergencePercent = config.maxDivergencePercent ?? 50;
  }

  async getFee(chainId: ChainId): Promise<FeeEstimate | undefined> {
    const cached = this.cache.get(chainId);
    if (cached === undefined) {
      return undefined;
    }
    // INV-6: Fee estimates older than maxFeeAgeMs are degraded to low confidence
    const age = Date.now() - cached.timestamp;
    if (age > this.maxFeeAgeMs) {
      return { ...cached, confidence: 'low' };
    }
    return cached;
  }

  async getAllFees(): Promise<ReadonlyMap<ChainId, FeeEstimate>> {
    const result = new Map<ChainId, FeeEstimate>();
    for (const [chainId, estimate] of this.cache) {
      // INV-6: Fee estimates older than maxFeeAgeMs are degraded to low confidence
      const age = Date.now() - estimate.timestamp;
      if (age > this.maxFeeAgeMs) {
        result.set(chainId, { ...estimate, confidence: 'low' });
      } else {
        result.set(chainId, estimate);
      }
    }
    return result;
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;

    // Poll each chain independently with its own interval
    for (const chainId of this.adapters.keys()) {
      // Initial poll
      void this.pollChain(chainId);

      const timer = setInterval(() => {
        void this.pollChain(chainId);
      }, this.pollIntervalMs);

      this.timers.set(chainId, timer);
    }
  }

  stop(): void {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
    this.started = false;
  }

  /**
   * Poll a single chain: try primary adapter, then fallback.
   * Cross-validate if both return results.
   */
  private async pollChain(chainId: ChainId): Promise<void> {
    const adapter = this.adapters.get(chainId);
    if (adapter === undefined) {
      return;
    }

    let primaryEstimate: FeeEstimate | undefined;
    try {
      // Use a dummy payment for fee estimation
      primaryEstimate = await adapter.estimateFee({
        chainId,
        payTo: '0x0',
        // BigInt: token amounts must never use floating point
        amount: 0n,
        token: 'native',
      });
    } catch {
      // Primary failed, try fallback
    }

    // If primary failed, try fallback adapter
    const fallbackAdapter = this.fallbackAdapters.get(chainId);
    if (primaryEstimate === undefined && fallbackAdapter !== undefined) {
      try {
        primaryEstimate = await fallbackAdapter.estimateFee({
          chainId,
          payTo: '0x0',
          // BigInt: token amounts must never use floating point
          amount: 0n,
          token: 'native',
        });
      } catch {
        // Fallback also failed, no estimate available
      }
    }

    if (primaryEstimate === undefined) {
      return;
    }

    // Cross-validation: compare primary and fallback estimates
    let confidence = primaryEstimate.confidence;
    if (fallbackAdapter !== undefined && primaryEstimate !== undefined) {
      try {
        const fallbackEstimate = await fallbackAdapter.estimateFee({
          chainId,
          payTo: '0x0',
          // BigInt: token amounts must never use floating point
          amount: 0n,
          token: 'native',
        });

        // Cross-validation: if primary and fallback disagree by >maxDivergencePercent%, confidence: 'low'
        const divergence = this.calculateDivergence(
          primaryEstimate.feeUsd,
          fallbackEstimate.feeUsd,
        );
        if (divergence >= this.maxDivergencePercent) {
          confidence = 'low';
        }
      } catch {
        // Fallback unavailable for cross-validation, keep primary confidence
      }
    }

    this.cache.set(chainId, {
      ...primaryEstimate,
      confidence,
      timestamp: Date.now(),
    });

    // Evict entries older than 2x maxFeeAgeMs to prevent unbounded growth
    this.evictStale();
  }

  /** Remove cache entries older than 2x maxFeeAgeMs. */
  private evictStale(): void {
    const cutoff = Date.now() - this.maxFeeAgeMs * 2;
    for (const [chainId, estimate] of this.cache) {
      if (estimate.timestamp < cutoff) {
        this.cache.delete(chainId);
      }
    }
  }

  /**
   * Calculate percentage divergence between two BigInt fee values.
   * Returns a number representing the percentage difference.
   */
  private calculateDivergence(a: bigint, b: bigint): number {
    if (a === 0n && b === 0n) {
      return 0;
    }
    // BigInt: use BigInt arithmetic for the comparison, convert to number only for the percentage
    const diff = a > b ? a - b : b - a;
    const max = a > b ? a : b;
    // Convert to percentage: (diff * 100) / max
    // BigInt: token amounts must never use floating point — but this is a percentage, not a token amount
    return Number((diff * 100n) / max);
  }
}
