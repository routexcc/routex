import type { RouteOption } from '../types.js';

/**
 * Balanced routing strategy.
 * Score = 0.6 * (1 - normFee) + 0.4 * (1 - normFinality)
 * Normalization: divide by max value in the candidate set.
 * This linear weighting properly favors options that balance both dimensions.
 *
 * Pure function: no side effects.
 */
export function balanced(options: readonly RouteOption[]): readonly RouteOption[] {
  if (options.length === 0) {
    return [];
  }

  if (options.length === 1) {
    const only = options[0]!;
    return [{ ...only, score: 1 }];
  }

  // Find max values for normalization (divide by max per spec)
  // BigInt: feeUsd values are bigint
  let maxFee = options[0]!.fee.feeUsd;
  let maxFinality = options[0]!.fee.finalityMs;

  for (const opt of options) {
    if (opt.fee.feeUsd > maxFee) maxFee = opt.fee.feeUsd;
    if (opt.fee.finalityMs > maxFinality) maxFinality = opt.fee.finalityMs;
  }

  // BigInt: convert max fee to number for normalization division
  const maxFeeNum = Number(maxFee);
  const maxFinalityNum = maxFinality;

  return options
    .map((option) => {
      // Normalize to [0, 1] by dividing by max value in candidate set
      // BigInt: convert feeUsd to number for normalization
      const normFee = maxFeeNum > 0 ? Number(option.fee.feeUsd) / maxFeeNum : 0;
      const normFinality =
        maxFinalityNum > 0 ? option.fee.finalityMs / maxFinalityNum : 0;

      // Score: higher is better. (1 - norm) inverts so lower fee/finality = higher score.
      // 0.6 weight on fee, 0.4 weight on finality.
      // Add small base to ensure all scores are positive (worst option gets epsilon, not zero).
      const score = 0.6 * (1 - normFee) + 0.4 * (1 - normFinality) + 0.001;
      return { ...option, score };
    })
    .sort((a, b) => b.score - a.score);
}
