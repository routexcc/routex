/**
 * Stellar chain adapter for Routex.
 * Uses a StellarRpcClient interface (compatible with @stellar/stellar-sdk).
 * Finality: ~5000ms (ledger close time).
 */

import type {
  ChainAdapter,
  AcceptedPayment,
  FeeEstimate,
  PaymentPayload,
  Signer,
  TokenBalance,
} from '@routexcc/core';
import { PaymentConstructionError } from '@routexcc/core';

// ─── Stellar RPC Client Interface ──────────────────────────────────────────

/** Balance entry from Stellar account query. */
export interface StellarBalance {
  readonly asset_type: string;
  readonly asset_code?: string;
  readonly asset_issuer?: string;
  readonly balance: string;
}

/** Stellar account response shape. */
export interface StellarAccountResponse {
  readonly balances: readonly StellarBalance[];
}

/** Stellar fee stats response shape. */
export interface StellarFeeStats {
  readonly fee_charged: { readonly p50: string };
  readonly last_ledger_base_fee: string;
}

/**
 * Minimal interface for Stellar RPC operations.
 * Compatible with @stellar/stellar-sdk Server class.
 */
export interface StellarRpcClient {
  getAccount(accountId: string): Promise<StellarAccountResponse>;
  getFeeStats(): Promise<StellarFeeStats>;
}

// ─── Stellar Adapter Configuration ─────────────────────────────────────────

/** Configuration for the Stellar adapter. */
export interface StellarAdapterConfig {
  /** Injected Stellar RPC client. */
  readonly rpcClient: StellarRpcClient;
  /** USDC asset code (default: 'USDC'). */
  readonly usdcAssetCode?: string;
  /** USDC asset issuer public key. */
  readonly usdcAssetIssuer?: string;
  /** XLM price in USD (6-decimal precision bigint). */
  // BigInt: token amounts must never use floating point
  readonly xlmPriceUsd: bigint;
}

// ─── Constants ─────────────────────────────────────────────────────────────

/** Stellar finality ~5 seconds (ledger close time). */
const STELLAR_FINALITY_MS = 5000;

/** Default USDC issuer on Stellar (Centre). */
const DEFAULT_USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

/** Stellar amounts have 7 decimal places. */
const STELLAR_DECIMALS = 7;

// ─── StellarAdapter ────────────────────────────────────────────────────────

/**
 * Stellar chain adapter implementation.
 * Reads USDC trustline balances, estimates fees via fee_stats,
 * and constructs signed payment operation envelopes.
 */
export class StellarAdapter implements ChainAdapter {
  readonly chainId = 'stellar' as const;
  private readonly rpcClient: StellarRpcClient;
  private readonly usdcAssetCode: string;
  private readonly usdcAssetIssuer: string;
  // BigInt: XLM price in USD (6-decimal precision)
  private readonly xlmPriceUsd: bigint;

  constructor(config: StellarAdapterConfig) {
    this.rpcClient = config.rpcClient;
    this.usdcAssetCode = config.usdcAssetCode ?? 'USDC';
    this.usdcAssetIssuer = config.usdcAssetIssuer ?? DEFAULT_USDC_ISSUER;
    this.xlmPriceUsd = config.xlmPriceUsd;
  }

  /**
   * Query USDC trustline balance for a Stellar account.
   */
  async getBalance(address: string, _token: string): Promise<TokenBalance> {
    const account = await this.rpcClient.getAccount(address);

    const usdcBalance = account.balances.find(
      (b) =>
        b.asset_code === this.usdcAssetCode &&
        b.asset_issuer === this.usdcAssetIssuer,
    );

    // BigInt: convert Stellar string balance (7 decimals) to smallest unit
    // Stellar USDC has 7 decimal places, but USDC standard is 6
    // We store in 6-decimal precision (micro-USDC)
    const balanceStr = usdcBalance?.balance ?? '0';
    const balance = stellarAmountToBigInt(balanceStr);

    return {
      chainId: this.chainId,
      token: `${this.usdcAssetCode}:${this.usdcAssetIssuer}`,
      // BigInt: token balance in smallest unit (6 decimals)
      balance,
      timestamp: Date.now(),
    };
  }

  /**
   * Estimate fee using Stellar fee_stats endpoint.
   * Uses p50 fee from fee_charged as the estimate.
   */
  async estimateFee(payment: AcceptedPayment): Promise<FeeEstimate> {
    const feeStats = await this.rpcClient.getFeeStats();

    // BigInt: Stellar fees are in stroops (1 XLM = 10^7 stroops)
    const feeStroops = BigInt(feeStats.fee_charged.p50);

    // BigInt: convert stroops to USD (6-decimal precision)
    // feeStroops is in stroops (7 decimals), xlmPriceUsd is 6 decimals
    // result = feeStroops * xlmPriceUsd / 10^7
    const feeUsd = (feeStroops * this.xlmPriceUsd) / 10n ** BigInt(STELLAR_DECIMALS);

    return {
      chainId: payment.chainId,
      // BigInt: fee in stroops
      feeAmount: feeStroops,
      // BigInt: fee in USD with 6-decimal precision
      feeUsd,
      finalityMs: STELLAR_FINALITY_MS,
      confidence: 'high',
      timestamp: Date.now(),
    };
  }

  /**
   * Construct a signed Stellar payment operation envelope.
   * INV-1: Never accesses signer private keys — only calls signer.sign().
   * INV-2: Recipient in payload matches payment requirement.
   */
  async buildPaymentPayload(
    payment: AcceptedPayment,
    signer: Signer,
  ): Promise<PaymentPayload> {
    // INV-1: No private key access — only use signer.sign()
    // Construct a payment operation envelope for signing
    const envelope = JSON.stringify({
      type: 'stellar_payment',
      source: signer.address,
      destination: payment.payTo,
      // BigInt: amount serialized for Stellar
      amount: payment.amount.toString(),
      asset: {
        code: this.usdcAssetCode,
        issuer: this.usdcAssetIssuer,
      },
      nonce: uniqueNonce(),
    });

    let signature: Uint8Array;
    try {
      signature = await signer.sign(new TextEncoder().encode(envelope));
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : 'Unknown signing error';
      throw new PaymentConstructionError(this.chainId, 'sign', detail);
    }

    // Encode signature as hex string
    const signatureHex = Array.from(signature)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // INV-2: Recipient in payload must match payment requirement
    return {
      chainId: this.chainId,
      to: payment.payTo,
      // BigInt: token amount in smallest unit
      amount: payment.amount,
      token: `${this.usdcAssetCode}:${this.usdcAssetIssuer}`,
      data: JSON.stringify({ envelope, signature: signatureHex }),
    };
  }

  /** Get expected finality time for Stellar (~5 seconds). */
  getFinality(): number {
    return STELLAR_FINALITY_MS;
  }
}

// ─── Utility ───────────────────────────────────────────────────────────────

/**
 * Convert a Stellar string amount (e.g. "1000.0000000") to bigint in 6-decimal precision.
 * Stellar uses 7 decimal places; we normalize to 6 (standard USDC precision).
 */
function stellarAmountToBigInt(amount: string): bigint {
  const [whole = '0', frac = ''] = amount.split('.');
  // Stellar has 7 decimals, but we want 6 decimal precision
  const paddedFrac = frac.padEnd(6, '0').slice(0, 6);
  // BigInt: construct from whole + fractional parts
  return BigInt(whole) * 1_000_000n + BigInt(paddedFrac);
}

export { STELLAR_FINALITY_MS, DEFAULT_USDC_ISSUER };

/** Monotonic counter for unique nonce generation. */
let nonceCounter = 0;

/** Generate a unique nonce (timestamp + counter) to prevent collisions within the same millisecond. */
function uniqueNonce(): number {
  return Date.now() * 1000 + (nonceCounter++ % 1000);
}
