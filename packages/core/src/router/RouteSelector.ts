import type {
  ChainId,
  RouteConfig,
  PaymentRequirement,
  AcceptedPayment,
  FeeEstimate,
  RouteOption,
  RejectionReason,
  CustomStrategy,
} from '../types.js';
import { RouteExhaustedError } from '../errors.js';
import { cheapest } from '../strategy/cheapest.js';
import { fastest } from '../strategy/fastest.js';
import { balanced } from '../strategy/balanced.js';
import { custom } from '../strategy/custom.js';

/**
 * Five-step routing pipeline: parse → filter → score → select → verify
 *
 * INV-9: Each route() call is independent. No mutable module-level state.
 */
export class RouteSelector {
  private readonly config: RouteConfig;

  constructor(config: RouteConfig) {
    this.config = config;
  }

  /**
   * Execute the five-step routing pipeline.
   * Returns scored and verified route options, or throws RouteExhaustedError.
   */
  async select(
    requirement: PaymentRequirement,
    balances: ReadonlyMap<ChainId, bigint>,
    fees: ReadonlyMap<ChainId, FeeEstimate>,
  ): Promise<readonly RouteOption[]> {
    // Step 1: Parse — extract candidates from the payment requirement
    const candidates = this.parse(requirement);

    // Step 2: Filter — remove ineligible candidates
    const { eligible, rejections } = this.filter(candidates, balances, fees);

    // INV-5: No eligible route → RouteExhaustedError (never silent drop)
    if (eligible.length === 0) {
      throw new RouteExhaustedError(rejections);
    }

    // Step 3: Score — apply routing strategy
    const scored = this.score(eligible);

    // Step 4: Select — already sorted by score from strategy
    // Step 5: Verify — validate invariants on top candidate
    this.verify(scored, requirement);

    return scored;
  }

  /**
   * Step 1: Parse — build RouteOption candidates from payment requirement.
   */
  private parse(requirement: PaymentRequirement): readonly RouteOption[] {
    return requirement.acceptedChains.map((payment) => ({
      chainId: payment.chainId,
      payment,
      fee: {
        chainId: payment.chainId,
        // BigInt: placeholder values, will be replaced with real fees in filter step
        feeAmount: 0n,
        feeUsd: 0n,
        finalityMs: 0,
        confidence: 'low' as const,
        timestamp: 0,
      },
      // BigInt: placeholder, will be replaced with real balance in filter step
      balance: 0n,
      score: 0,
    }));
  }

  /**
   * Step 2: Filter — remove candidates that don't meet requirements.
   * Returns eligible candidates with real fees/balances attached, plus rejection reasons.
   */
  private filter(
    candidates: readonly RouteOption[],
    balances: ReadonlyMap<ChainId, bigint>,
    fees: ReadonlyMap<ChainId, FeeEstimate>,
  ): { eligible: RouteOption[]; rejections: RejectionReason[] } {
    const eligible: RouteOption[] = [];
    const rejections: RejectionReason[] = [];

    for (const candidate of candidates) {
      const rejection = this.checkEligibility(candidate.payment, balances, fees);
      if (rejection !== undefined) {
        rejections.push(rejection);
        continue;
      }

      // Attach real fee and balance data
      const fee = fees.get(candidate.chainId)!;
      const balance = balances.get(candidate.chainId)!;
      eligible.push({
        ...candidate,
        fee,
        balance,
      });
    }

    return { eligible, rejections };
  }

  /**
   * Check a single candidate's eligibility. Returns a rejection reason or undefined if eligible.
   */
  private checkEligibility(
    payment: AcceptedPayment,
    balances: ReadonlyMap<ChainId, bigint>,
    fees: ReadonlyMap<ChainId, FeeEstimate>,
  ): RejectionReason | undefined {
    const { chainId } = payment;

    // Check: chain excluded
    if (this.config.excludeChains?.includes(chainId)) {
      return { chainId, reason: 'Chain excluded by configuration', code: 'CHAIN_EXCLUDED' };
    }

    // Check: adapter available
    if (!this.config.adapters.has(chainId)) {
      return { chainId, reason: 'No adapter configured for chain', code: 'NO_ADAPTER' };
    }

    // Check: fee available
    const fee = fees.get(chainId);
    if (fee === undefined) {
      return { chainId, reason: 'Fee estimate unavailable', code: 'FEE_UNAVAILABLE' };
    }

    // INV-6: Check stale fees
    const feeAge = Date.now() - fee.timestamp;
    if (feeAge > this.config.maxFeeAgeMs) {
      return {
        chainId,
        reason: `Fee estimate stale: ${feeAge}ms old (max: ${this.config.maxFeeAgeMs}ms)`,
        code: 'STALE_FEE',
      };
    }

    // Check: fee within limits
    if (this.config.maxFeeUsd !== undefined && fee.feeUsd > this.config.maxFeeUsd) {
      return {
        chainId,
        // BigInt: fee amounts in error message
        reason: `Fee too high: ${fee.feeUsd} > max ${this.config.maxFeeUsd}`,
        code: 'FEE_TOO_HIGH',
      };
    }

    // Check: finality within limits
    if (this.config.maxFinalityMs !== undefined && fee.finalityMs > this.config.maxFinalityMs) {
      return {
        chainId,
        reason: `Finality too slow: ${fee.finalityMs}ms > max ${this.config.maxFinalityMs}ms`,
        code: 'FINALITY_TOO_SLOW',
      };
    }

    // Check: sufficient balance
    const balance = balances.get(chainId);
    if (balance === undefined) {
      return { chainId, reason: 'Balance unavailable', code: 'INSUFFICIENT_BALANCE' };
    }
    // BigInt: token amounts must never use floating point
    const totalRequired = payment.amount + fee.feeAmount;
    if (balance < totalRequired) {
      return {
        chainId,
        // BigInt: token amounts in error message
        reason: `Insufficient balance: need ${totalRequired}, have ${balance}`,
        code: 'INSUFFICIENT_BALANCE',
      };
    }

    return undefined;
  }

  /**
   * Step 3: Score — apply the configured routing strategy.
   */
  private score(options: RouteOption[]): readonly RouteOption[] {
    const strategy = this.config.strategy;

    if (strategy === 'cheapest') {
      return cheapest(options);
    }
    if (strategy === 'fastest') {
      return fastest(options);
    }
    if (strategy === 'balanced') {
      return balanced(options);
    }
    // CustomStrategy
    return custom(options, strategy as CustomStrategy);
  }

  /**
   * Step 5: Verify — validate invariants on the selected candidates.
   */
  private verify(
    scored: readonly RouteOption[],
    requirement: PaymentRequirement,
  ): void {
    for (const option of scored) {
      const accepted = requirement.acceptedChains.find(
        (a) => a.chainId === option.chainId,
      );

      if (accepted === undefined) {
        // INV-4: Chain ID must match an accepted chain
        throw new RouteExhaustedError([
          {
            chainId: option.chainId,
            reason: 'Chain ID does not match an accepted chain',
            code: 'NO_ADAPTER',
          },
        ]);
      }

      // INV-2: Recipient in payload must match recipient in 402 requirement
      if (option.payment.payTo !== accepted.payTo) {
        throw new RouteExhaustedError([
          {
            chainId: option.chainId,
            reason: 'Recipient mismatch',
            code: 'NO_ADAPTER',
          },
        ]);
      }

      // INV-3: Amount in payload must match amount in 402 requirement
      // BigInt: token amounts must never use floating point
      if (option.payment.amount !== accepted.amount) {
        throw new RouteExhaustedError([
          {
            chainId: option.chainId,
            reason: 'Amount mismatch',
            code: 'NO_ADAPTER',
          },
        ]);
      }

      // INV-4: Chain ID in route must match chain ID in payment
      if (option.fee.chainId !== option.chainId) {
        throw new RouteExhaustedError([
          {
            chainId: option.chainId,
            reason: 'Chain ID mismatch in fee estimate',
            code: 'NO_ADAPTER',
          },
        ]);
      }
    }
  }
}
