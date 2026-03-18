import { describe, it, expect } from 'vitest';
import { fastest } from '../../src/strategy/fastest.js';
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

describe('fastest strategy', () => {
  it('picks the option with the lowest finality', () => {
    const options: RouteOption[] = [
      makeOption({ chainId: 'base', finalityMs: 5000 }),
      makeOption({ chainId: 'solana', finalityMs: 400 }),
      makeOption({ chainId: 'polygon', finalityMs: 2000 }),
    ];

    const result = fastest(options);
    expect(result[0].chainId).toBe('solana');
    expect(result[1].chainId).toBe('polygon');
    expect(result[2].chainId).toBe('base');
  });

  it('tie-breaks by fee when finality is equal', () => {
    const options: RouteOption[] = [
      // BigInt: different feeUsd values
      makeOption({ chainId: 'base', finalityMs: 2000, feeUsd: 500000n }),
      makeOption({ chainId: 'polygon', finalityMs: 2000, feeUsd: 100000n }),
    ];

    const result = fastest(options);
    expect(result[0].chainId).toBe('polygon');
  });

  it('tie-breaks by fee when the first option is cheaper', () => {
    const options: RouteOption[] = [
      // BigInt: different feeUsd values
      makeOption({ chainId: 'base', finalityMs: 2000, feeUsd: 100000n }),
      makeOption({ chainId: 'polygon', finalityMs: 2000, feeUsd: 500000n }),
    ];

    const result = fastest(options);
    expect(result[0].chainId).toBe('base');
  });

  it('keeps deterministic order when finality and fee are equal', () => {
    const options: RouteOption[] = [
      makeOption({ chainId: 'base', finalityMs: 2000, feeUsd: 500000n }),
      makeOption({ chainId: 'polygon', finalityMs: 2000, feeUsd: 500000n }),
    ];

    const result = fastest(options);
    expect(result[0].chainId).toBe('base');
    expect(result[1].chainId).toBe('polygon');
  });

  it('returns empty array for empty input', () => {
    expect(fastest([])).toEqual([]);
  });

  it('assigns higher scores to faster options', () => {
    const options: RouteOption[] = [
      makeOption({ chainId: 'base', finalityMs: 10000 }),
      makeOption({ chainId: 'solana', finalityMs: 400 }),
    ];

    const result = fastest(options);
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });
});
