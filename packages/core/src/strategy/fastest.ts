import type { RouteOption } from '../types.js';

/**
 * Fastest routing strategy.
 * Score = 1 / (finalityMs + 1), tie-break by fee (lower is better).
 *
 * Pure function: no side effects.
 */
export function fastest(options: readonly RouteOption[]): readonly RouteOption[] {
  return options
    .map((option) => {
      const score = 1 / (option.fee.finalityMs + 1);
      return { ...option, score };
    })
    .sort((a, b) => {
      // Higher score = faster = better
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      // BigInt: tie-break by feeUsd (lower is better)
      if (a.fee.feeUsd < b.fee.feeUsd) return -1;
      if (a.fee.feeUsd > b.fee.feeUsd) return 1;
      return 0;
    });
}
