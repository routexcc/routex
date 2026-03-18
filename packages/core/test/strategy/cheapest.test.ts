import { describe, it, expect } from 'vitest';
import { cheapest } from '../../src/strategy/cheapest.js';
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

describe('cheapest strategy', () => {
  it('picks the option with the lowest fee', () => {
    const options: RouteOption[] = [
      // BigInt: feeUsd values
      makeOption({ chainId: 'base', feeUsd: 500000n }),
      makeOption({ chainId: 'polygon', feeUsd: 100000n }),
      makeOption({ chainId: 'stellar', feeUsd: 300000n }),
    ];

    const result = cheapest(options);
    expect(result[0].chainId).toBe('polygon');
    expect(result[1].chainId).toBe('stellar');
    expect(result[2].chainId).toBe('base');
  });

  it('tie-breaks by finality when fees are equal', () => {
    const options: RouteOption[] = [
      // BigInt: same feeUsd
      makeOption({ chainId: 'base', feeUsd: 500000n, finalityMs: 5000 }),
      makeOption({ chainId: 'polygon', feeUsd: 500000n, finalityMs: 1000 }),
    ];

    const result = cheapest(options);
    expect(result[0].chainId).toBe('polygon');
  });

  it('returns empty array for empty input', () => {
    expect(cheapest([])).toEqual([]);
  });

  it('assigns higher scores to cheaper options', () => {
    const options: RouteOption[] = [
      // BigInt: feeUsd values
      makeOption({ chainId: 'base', feeUsd: 1000000n }),
      makeOption({ chainId: 'polygon', feeUsd: 100000n }),
    ];

    const result = cheapest(options);
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  it('uses bigint for all fee comparisons', () => {
    const options: RouteOption[] = [
      // BigInt: very large token amounts
      makeOption({ chainId: 'base', feeUsd: 999999999999999n }),
      makeOption({ chainId: 'polygon', feeUsd: 1n }),
    ];

    const result = cheapest(options);
    expect(result[0].chainId).toBe('polygon');
    // Verify fee values are still bigint
    expect(typeof result[0].fee.feeUsd).toBe('bigint');
    expect(typeof result[1].fee.feeUsd).toBe('bigint');
  });
});
