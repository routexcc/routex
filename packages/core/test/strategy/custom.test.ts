import { describe, it, expect } from 'vitest';
import { custom } from '../../src/strategy/custom.js';
import type { RouteOption, CustomStrategy } from '../../src/types.js';

function makeOption(chainId: 'base' | 'polygon'): RouteOption {
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
      feeUsd: 500000n,
      finalityMs: 2000,
      confidence: 'high',
      timestamp: Date.now(),
    },
    // BigInt: token amounts must never use floating point
    balance: 10000000n,
    score: 0,
  };
}

describe('custom strategy', () => {
  it('delegates to user-provided scorer', () => {
    const strategy: CustomStrategy = {
      type: 'custom',
      scorer: (options) =>
        [...options]
          .map((o) => ({ ...o, score: o.chainId === 'polygon' ? 100 : 1 }))
          .sort((a, b) => b.score - a.score),
    };

    const options: RouteOption[] = [makeOption('base'), makeOption('polygon')];
    const result = custom(options, strategy);

    expect(result[0].chainId).toBe('polygon');
    expect(result[0].score).toBe(100);
  });

  it('returns empty when scorer returns empty', () => {
    const strategy: CustomStrategy = {
      type: 'custom',
      scorer: () => [],
    };

    const result = custom([makeOption('base')], strategy);
    expect(result).toEqual([]);
  });
});
