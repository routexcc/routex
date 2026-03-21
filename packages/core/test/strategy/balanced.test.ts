import { describe, it, expect } from 'vitest';
import { balanced } from '../../src/strategy/balanced.js';
import type { RouteOption } from '../../src/types.js';

function makeOption(overrides: {
  chainId?: 'base' | 'stellar' | 'solana' | 'polygon';
  feeUsd?: bigint;
  finalityMs?: number;
}): RouteOption {
  const chainId = overrides.chainId ?? 'base';
  return {
    chainId,
    payment: {
      chainId,
      payTo: '0xRecipient',
      // BigInt: token amounts must never use floating point
      amount: 1000000n,
      token: 'USDC',
    },
    fee: {
      chainId,
      // BigInt: token amounts must never use floating point
      feeAmount: 1000n,
      feeUsd: overrides.feeUsd ?? 500000n,
      finalityMs: overrides.finalityMs ?? 2000,
      confidence: 'high',
      timestamp: Date.now(),
    },
    // BigInt: token amounts must never use floating point
    balance: 10000000n,
    score: 0,
  };
}

describe('balanced strategy', () => {
  it('prefers option that balances low fee and low finality', () => {
    const options: RouteOption[] = [
      // Cheap but slow
      makeOption({ chainId: 'stellar', feeUsd: 100000n, finalityMs: 10000 }),
      // Expensive but fast
      makeOption({ chainId: 'solana', feeUsd: 1000000n, finalityMs: 400 }),
      // Balanced: moderate fee and finality
      makeOption({ chainId: 'base', feeUsd: 200000n, finalityMs: 2000 }),
    ];

    const result = balanced(options);
    // The balanced option (low fee + moderate finality) should rank high
    expect(result[0].chainId).toBe('base');
  });

  it('returns single option with score 1', () => {
    const options = [makeOption({ chainId: 'base' })];
    const result = balanced(options);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(1);
  });

  it('returns empty array for empty input', () => {
    expect(balanced([])).toEqual([]);
  });

  it('handles identical options', () => {
    const options: RouteOption[] = [
      makeOption({ chainId: 'base', feeUsd: 500000n, finalityMs: 2000 }),
      makeOption({ chainId: 'polygon', feeUsd: 500000n, finalityMs: 2000 }),
    ];

    const result = balanced(options);
    expect(result).toHaveLength(2);
    // Both should have equal scores
    expect(result[0].score).toBe(result[1].score);
  });

  it('handles zero-fee options (maxFeeNum = 0 guard)', () => {
    const options: RouteOption[] = [
      makeOption({ chainId: 'base', feeUsd: 0n, finalityMs: 2000 }),
      makeOption({ chainId: 'polygon', feeUsd: 0n, finalityMs: 3000 }),
    ];

    const result = balanced(options);
    expect(result).toHaveLength(2);
    // Both have zero fee, so fee normalization should produce 0
    // Faster finality should win
    expect(result[0].chainId).toBe('base');
    for (const r of result) {
      expect(r.score).toBeGreaterThan(0);
    }
  });

  it('handles zero-finality options (maxFinalityNum = 0 guard)', () => {
    const options: RouteOption[] = [
      makeOption({ chainId: 'base', feeUsd: 100000n, finalityMs: 0 }),
      makeOption({ chainId: 'polygon', feeUsd: 200000n, finalityMs: 0 }),
    ];

    const result = balanced(options);
    expect(result).toHaveLength(2);
    // Both have zero finality, cheaper should win
    expect(result[0].chainId).toBe('base');
  });

  it('all scores are non-negative numbers', () => {
    const options: RouteOption[] = [
      // BigInt: diverse feeUsd values
      makeOption({ chainId: 'base', feeUsd: 100000n, finalityMs: 1000 }),
      makeOption({ chainId: 'polygon', feeUsd: 500000n, finalityMs: 5000 }),
      makeOption({ chainId: 'stellar', feeUsd: 200000n, finalityMs: 3000 }),
    ];

    const result = balanced(options);
    for (const r of result) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(typeof r.score).toBe('number');
    }
    // Best option should have positive score
    expect(result[0].score).toBeGreaterThan(0);
  });
});
