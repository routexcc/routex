import type { RouteOption, CustomStrategy } from '../types.js';

/**
 * Custom routing strategy.
 * Delegates scoring to user-provided scorer function.
 *
 * Pure function wrapper: no side effects beyond calling the user's scorer.
 */
export function custom(
  options: readonly RouteOption[],
  strategy: CustomStrategy,
): readonly RouteOption[] {
  return strategy.scorer(options);
}
