/**
 * Solana chain adapter for Routex.
 * Uses a SolanaRpcClient interface (compatible with @solana/web3.js Connection).
 * Finality: ~400ms (slot time).
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

// ─── Solana RPC Client Interface ───────────────────────────────────────────

/** Solana token balance response shape. */
export interface SolanaTokenBalanceResponse {
  readonly value: {
    readonly amount: string;
    readonly decimals: number;
  };
}

/** Solana token accounts response shape. */
export interface SolanaTokenAccountsResponse {
  readonly value: readonly { readonly pubkey: string }[];
}

/** Solana priority fee entry. */
export interface SolanaPriorityFee {
  readonly prioritizationFee: number;
}

/**
 * Minimal interface for Solana RPC operations.
 * Compatible with @solana/web3.js Connection class.
 */
export interface SolanaRpcClient {
  getTokenAccountBalance(address: string): Promise<SolanaTokenBalanceResponse>;
  getTokenAccountsByOwner(
    owner: string,
    filter: { readonly mint: string },
  ): Promise<SolanaTokenAccountsResponse>;
  getRecentPrioritizationFees(): Promise<readonly SolanaPriorityFee[]>;
}

// ─── Solana Adapter Configuration ──────────────────────────────────────────

/** Configuration for the Solana adapter. */
export interface SolanaAdapterConfig {
  /** Injected Solana RPC client. */
  readonly rpcClient: SolanaRpcClient;
  /** SOL price in USD (6-decimal precision bigint). */
  // BigInt: token amounts must never use floating point
  readonly solPriceUsd: bigint;
}

// ─── Constants ─────────────────────────────────────────────────────────────

/** Solana finality ~400ms (slot time). */
const SOLANA_FINALITY_MS = 400;

/** Solana base fee per signature in lamports. */
// BigInt: fee in lamports
const BASE_FEE_LAMPORTS = 5000n;

/** SOL has 9 decimal places (1 SOL = 10^9 lamports). */
const SOL_DECIMALS = 9;

// ─── SolanaAdapter ─────────────────────────────────────────────────────────

/**
 * Solana chain adapter implementation.
 * Reads SPL token balances, estimates fees via prioritization fees,
 * and constructs signed SPL token transfer instructions.
 */
export class SolanaAdapter implements ChainAdapter {
  readonly chainId = 'solana' as const;
  private readonly rpcClient: SolanaRpcClient;
  // BigInt: SOL price in USD (6-decimal precision)
  private readonly solPriceUsd: bigint;

  constructor(config: SolanaAdapterConfig) {
    this.rpcClient = config.rpcClient;
    this.solPriceUsd = config.solPriceUsd;
  }

  /**
   * Query SPL token account balance.
   * First finds token accounts by owner, then reads the balance.
   */
  async getBalance(address: string, token: string): Promise<TokenBalance> {
    const accounts = await this.rpcClient.getTokenAccountsByOwner(address, {
      mint: token,
    });

    if (accounts.value.length === 0) {
      return {
        chainId: this.chainId,
        token,
        // BigInt: zero balance when no token account exists
        balance: 0n,
        timestamp: Date.now(),
      };
    }

    const firstAccount = accounts.value[0];
    if (!firstAccount) {
      return {
        chainId: this.chainId,
        token,
        // BigInt: zero balance fallback
        balance: 0n,
        timestamp: Date.now(),
      };
    }

    const balanceResult = await this.rpcClient.getTokenAccountBalance(
      firstAccount.pubkey,
    );

    // BigInt: convert string amount to bigint
    const balance = BigInt(balanceResult.value.amount);

    return {
      chainId: this.chainId,
      token,
      // BigInt: token balance in smallest unit
      balance,
      timestamp: Date.now(),
    };
  }

  /**
   * Estimate fee using base fee + recent prioritization fees.
   * Uses median of recent prioritization fees as priority fee estimate.
   */
  async estimateFee(payment: AcceptedPayment): Promise<FeeEstimate> {
    const recentFees = await this.rpcClient.getRecentPrioritizationFees();

    // Calculate median priority fee
    const sortedFees = [...recentFees]
      .map((f) => f.prioritizationFee)
      .sort((a, b) => a - b);

    // BigInt: priority fee in lamports (default to 0 if no recent fees)
    const medianPriorityFee =
      sortedFees.length > 0
        ? BigInt(sortedFees[Math.floor(sortedFees.length / 2)] ?? 0)
        : 0n;

    // BigInt: total fee = base fee + priority fee
    const feeAmount = BASE_FEE_LAMPORTS + medianPriorityFee;

    // BigInt: convert lamports to USD (6-decimal precision)
    // feeAmount is in lamports (9 decimals), solPriceUsd is 6 decimals
    // result = feeAmount * solPriceUsd / 10^9
    const feeUsd = (feeAmount * this.solPriceUsd) / 10n ** BigInt(SOL_DECIMALS);

    return {
      chainId: payment.chainId,
      // BigInt: fee in lamports
      feeAmount,
      // BigInt: fee in USD with 6-decimal precision
      feeUsd,
      finalityMs: SOLANA_FINALITY_MS,
      confidence: 'high',
      timestamp: Date.now(),
    };
  }

  /**
   * Construct a signed SPL token transfer instruction.
   * INV-1: Never accesses signer private keys — only calls signer.sign().
   * INV-2: Recipient in payload matches payment requirement.
   */
  async buildPaymentPayload(
    payment: AcceptedPayment,
    signer: Signer,
  ): Promise<PaymentPayload> {
    // INV-1: No private key access — only use signer.sign()
    // Construct an SPL token transfer instruction for signing
    const instruction = JSON.stringify({
      type: 'spl_transfer',
      program: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      source: signer.address,
      destination: payment.payTo,
      mint: payment.token,
      // BigInt: amount serialized for Solana instruction
      amount: payment.amount.toString(),
      nonce: Date.now(),
    });

    let signature: Uint8Array;
    try {
      signature = await signer.sign(new TextEncoder().encode(instruction));
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
      token: payment.token,
      data: JSON.stringify({ instruction, signature: signatureHex }),
    };
  }

  /** Get expected finality time for Solana (~400ms). */
  getFinality(): number {
    return SOLANA_FINALITY_MS;
  }
}

export { SOLANA_FINALITY_MS, BASE_FEE_LAMPORTS };
