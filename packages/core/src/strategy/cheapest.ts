import type { RouteOption } from '../types.js';

/**
 * Cheapest routing strategy.
 * Score = 1 / (feeUsd + 0.0001), tie-break by finality (lower is better).
 *
 * Pure function: no side effects.
 */
export function cheapest(options: readonly RouteOption[]): readonly RouteOption[] {
  return options
    .map((option) => {
      // BigInt: feeUsd is bigint with 6-decimal precision; convert to number for scoring
      // 0.0001 in 6-decimal precision = 100n
      const feeValue = Number(option.fee.feeUsd + 100n);
      const score = 1 / feeValue;
      return { ...option, score };
    })
    .sort((a, b) => {
      // Higher score = cheaper = better
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      // Tie-break by finality (lower finality is better)
      return a.fee.finalityMs - b.fee.finalityMs;
    });
}
