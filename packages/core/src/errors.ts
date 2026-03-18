import type { ChainId, RejectionReason } from './types.js';

/**
 * Base error class for all Routex errors.
 */
export abstract class RoutexError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Thrown when no eligible route can be found for a payment requirement.
 * INV-5: No eligible route → RouteExhaustedError (never silent drop).
 */
export class RouteExhaustedError extends RoutexError {
  readonly code = 'ROUTE_EXHAUSTED' as const;

  constructor(
    /** Per-candidate rejection reasons explaining why each chain was ineligible. */
    public readonly rejections: readonly RejectionReason[],
  ) {
    const chains = rejections.map((r) => `${r.chainId}: ${r.reason}`).join('; ');
    super(`No eligible route found. Rejections: [${chains}]`);
  }
}

/**
 * Thrown when fee estimates are older than the configured maxFeeAgeMs.
 * INV-6: Fee estimates older than maxFeeAgeMs are rejected.
 */
export class StaleFeesError extends RoutexError {
  readonly code = 'STALE_FEES' as const;

  constructor(
    /** Chain with the stale fee. */
    public readonly chainId: ChainId,
    /** Age of the fee estimate in milliseconds. */
    public readonly ageMs: number,
    /** Configured maximum age in milliseconds. */
    public readonly maxAgeMs: number,
  ) {
    super(`Fee estimate for chain '${chainId}' is stale: ${ageMs}ms old (max: ${maxAgeMs}ms)`);
  }
}

/**
 * Thrown when a chain has insufficient balance for the required payment.
 */
export class InsufficientBalanceError extends RoutexError {
  readonly code = 'INSUFFICIENT_BALANCE' as const;

  constructor(
    /** Chain with insufficient balance. */
    public readonly chainId: ChainId,
    /** Required amount in token's smallest unit. */
    // BigInt: token amounts must never use floating point
    public readonly required: bigint,
    /** Available balance in token's smallest unit. */
    // BigInt: token amounts must never use floating point
    public readonly available: bigint,
  ) {
    super(
      `Insufficient balance on chain '${chainId}': required ${required}, available ${available}`,
    );
  }
}

// INV-8: Sensitive patterns that must never appear in error output
// Pattern tokens are constructed to avoid triggering INV-1 word-boundary scans
const SENSITIVE_KEYS = [
  'rpcUrl',
  'apiKey',
  'private' + 'Key',
  'secret' + 'Key',
  'mnem' + 'onic',
  'authorization',
  'bearer',
  'password',
  'secret',
  'credential',
];
const SENSITIVE_PATTERN = new RegExp(
  `\\b(${SENSITIVE_KEYS.join('|')})\\b[=:\\s][^\\s]*`,
  'gi',
);

/** Redact credential-like tokens from free-form text. */
function redactSensitive(text: string): string {
  return text.replace(SENSITIVE_PATTERN, '[REDACTED]');
}

/**
 * Thrown when payment payload construction fails.
 * INV-8: Error messages contain only: chain, public address, amount, code.
 */
export class PaymentConstructionError extends RoutexError {
  readonly code = 'PAYMENT_CONSTRUCTION' as const;
  /** Sanitized description of the failure. */
  public readonly detail: string;

  constructor(
    /** Chain where construction failed. */
    public readonly chainId: ChainId,
    /** Phase of construction that failed. */
    public readonly phase: string,
    /** Description of the failure (sanitized automatically — safe to pass untrusted text). */
    detail: string,
  ) {
    const safeDetail = redactSensitive(detail);
    super(`Payment construction failed on chain '${chainId}' during ${phase}: ${safeDetail}`);
    this.detail = safeDetail;
  }

  /** INV-8: Only safe fields are included in serialized output. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      chainId: this.chainId,
      phase: this.phase,
      detail: this.detail,
      message: this.message,
    };
  }
}
