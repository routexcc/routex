/**
 * Supported blockchain identifiers.
 */
export type ChainId = 'base' | 'stellar' | 'solana' | 'polygon';

/**
 * Configuration for the Routex router.
 */
export interface RouteConfig {
  /** Chain adapters keyed by chain ID. */
  readonly adapters: ReadonlyMap<ChainId, ChainAdapter>;
  /** Fee oracle instance for retrieving fee estimates. */
  readonly feeOracle: FeeOracle;
  /** Routing strategy to apply. */
  readonly strategy: RoutingStrategy;
  /** Maximum acceptable fee in USD (as bigint with 6 decimal precision). */
  readonly maxFeeUsd?: bigint;
  /** Maximum acceptable finality time in milliseconds. */
  readonly maxFinalityMs?: number;
  /** Maximum age of fee estimates in milliseconds before they are considered stale. */
  readonly maxFeeAgeMs: number;
  /** Chains to exclude from routing. */
  readonly excludeChains?: readonly ChainId[];
  /** Optional cloud API key to enable v2 features. */
  readonly cloudApiKey?: string;
  /** Enable batch settlement (requires cloudApiKey). */
  readonly enableBatching?: boolean;
}

/**
 * Routing strategy identifier or custom scorer.
 */
export type RoutingStrategy = 'cheapest' | 'fastest' | 'balanced' | CustomStrategy;

/**
 * Custom routing strategy with a user-provided scoring function.
 */
export interface CustomStrategy {
  readonly type: 'custom';
  readonly scorer: (options: readonly RouteOption[]) => readonly RouteOption[];
}

/**
 * A payment requirement extracted from a 402 response.
 */
export interface PaymentRequirement {
  /** Accepted chains and their payment details. */
  readonly acceptedChains: readonly AcceptedPayment[];
}

/**
 * Payment details for a single accepted chain in a 402 response.
 */
export interface AcceptedPayment {
  /** Chain identifier. */
  readonly chainId: ChainId;
  /** Recipient wallet address (public). */
  readonly payTo: string;
  /** Required payment amount in the token's smallest unit. */
  // BigInt: token amounts must never use floating point
  readonly amount: bigint;
  /** Token contract address or native token identifier. */
  readonly token: string;
  /** Additional chain-specific data. */
  readonly extra?: Readonly<Record<string, string>>;
}

/**
 * A fee estimate for a specific chain.
 */
export interface FeeEstimate {
  /** Chain this estimate applies to. */
  readonly chainId: ChainId;
  /** Estimated transaction fee in the token's smallest unit. */
  // BigInt: token amounts must never use floating point
  readonly feeAmount: bigint;
  /** Fee expressed in USD (6-decimal precision as bigint, e.g. 1_000_000n = $1.00). */
  // BigInt: token amounts must never use floating point
  readonly feeUsd: bigint;
  /** Estimated time to finality in milliseconds. */
  readonly finalityMs: number;
  /** Confidence level of this estimate. */
  readonly confidence: FeeConfidence;
  /** Unix timestamp (ms) when this estimate was created. */
  readonly timestamp: number;
}

/**
 * Confidence level for a fee estimate.
 */
export type FeeConfidence = 'high' | 'medium' | 'low';

/**
 * Interface for fee oracle implementations (local or cloud).
 */
export interface FeeOracle {
  /** Get the current fee estimate for a chain. Returns undefined if unavailable. */
  getFee(chainId: ChainId): Promise<FeeEstimate | undefined>;
  /** Get fee estimates for all known chains. */
  getAllFees(): Promise<ReadonlyMap<ChainId, FeeEstimate>>;
  /** Start polling for fee updates. */
  start(): void;
  /** Stop polling and clean up resources. */
  stop(): void;
}

/**
 * A candidate route option with scoring metadata.
 */
export interface RouteOption {
  /** Chain this option routes through. */
  readonly chainId: ChainId;
  /** Payment details for this chain from the 402 response. */
  readonly payment: AcceptedPayment;
  /** Fee estimate for this chain. */
  readonly fee: FeeEstimate;
  /** Available token balance on this chain. */
  // BigInt: token amounts must never use floating point
  readonly balance: bigint;
  /** Computed score (higher is better). */
  readonly score: number;
}

/**
 * The result of a successful route selection.
 */
export interface RouteResult {
  /** The selected chain. */
  readonly chainId: ChainId;
  /** The constructed payment payload ready for submission. */
  readonly payload: PaymentPayload;
  /** Fee estimate used for selection. */
  readonly fee: FeeEstimate;
  /** All evaluated route options with scores (for debugging/telemetry). */
  readonly evaluatedOptions: readonly RouteOption[];
}

/**
 * A constructed payment payload ready for on-chain submission.
 */
export interface PaymentPayload {
  /** Chain this payload targets. */
  readonly chainId: ChainId;
  /** Recipient wallet address. */
  readonly to: string;
  /** Payment amount in token's smallest unit. */
  // BigInt: token amounts must never use floating point
  readonly amount: bigint;
  /** Token contract address or identifier. */
  readonly token: string;
  /** Chain-specific signed transaction data. */
  readonly data: string;
}

/**
 * Token balance for a specific chain.
 */
export interface TokenBalance {
  /** Chain this balance is on. */
  readonly chainId: ChainId;
  /** Token contract address or identifier. */
  readonly token: string;
  /** Balance in the token's smallest unit. */
  // BigInt: token amounts must never use floating point
  readonly balance: bigint;
  /** Unix timestamp (ms) when this balance was last queried. */
  readonly timestamp: number;
}

/**
 * Signer interface — Routex never accesses private keys.
 * INV-1: No Routex function receives, stores, or returns a private key.
 */
export interface Signer {
  /** The public address of the signer. */
  readonly address: string;
  /** Sign arbitrary data. Implementation holds the key internally. */
  sign(data: Uint8Array): Promise<Uint8Array>;
  /** Sign EIP-712 typed data (EVM chains). */
  signTypedData?(typedData: Record<string, unknown>): Promise<string>;
}

/**
 * Chain adapter interface for blockchain-specific operations.
 */
export interface ChainAdapter {
  /** The chain this adapter handles. */
  readonly chainId: ChainId;
  /** Query the token balance for an address on this chain. */
  getBalance(address: string, token: string): Promise<TokenBalance>;
  /** Estimate the fee for a payment on this chain. */
  estimateFee(payment: AcceptedPayment): Promise<FeeEstimate>;
  /** Build a signed payment payload for submission. */
  buildPaymentPayload(payment: AcceptedPayment, signer: Signer): Promise<PaymentPayload>;
  /** Get the expected finality time in milliseconds. */
  getFinality(): number;
}

/**
 * Reason a candidate route was rejected during filtering.
 */
export interface RejectionReason {
  /** Chain that was rejected. */
  readonly chainId: ChainId;
  /** Human-readable reason for rejection. */
  readonly reason: string;
  /** Machine-readable rejection code. */
  readonly code: RejectionCode;
}

/**
 * Machine-readable codes for route rejection reasons.
 */
export type RejectionCode =
  | 'NO_ADAPTER'
  | 'INSUFFICIENT_BALANCE'
  | 'FEE_TOO_HIGH'
  | 'FINALITY_TOO_SLOW'
  | 'CHAIN_EXCLUDED'
  | 'STALE_FEE'
  | 'FEE_UNAVAILABLE';
