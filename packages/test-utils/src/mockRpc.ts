/**
 * Mock RPC server for deterministic adapter testing.
 * Supports configurable behaviors: success, error, timeout, malformed.
 * Used by all chain adapter tests — no live network calls in CI.
 */

import type { Signer } from '@routexcc/core';

// ─── Mock Behavior Configuration ───────────────────────────────────────────

/** Configurable RPC response behavior. */
export type MockBehavior = 'success' | 'error' | 'timeout' | 'malformed';

// ─── EVM Mock Client ───────────────────────────────────────────────────────

/** Minimal interface matching viem's PublicClient for EVM read operations. */
export interface EvmPublicClient {
  readContract(params: {
    readonly address: string;
    readonly abi: readonly Record<string, unknown>[];
    readonly functionName: string;
    readonly args: readonly unknown[];
  }): Promise<unknown>;
  getGasPrice(): Promise<bigint>;
  estimateGas(params: {
    readonly account?: string;
    readonly to: string;
    readonly data?: string;
    readonly value?: bigint;
  }): Promise<bigint>;
}

/** Configuration for the mock EVM client. */
export interface MockEvmClientConfig {
  readonly behavior?: MockBehavior;
  // BigInt: token balance in smallest unit
  readonly balance?: bigint;
  // BigInt: gas price in wei
  readonly gasPrice?: bigint;
  // BigInt: gas estimate in gas units
  readonly gasEstimate?: bigint;
  readonly timeoutMs?: number;
}

/** Default mock EVM values. */
// BigInt: token amounts must never use floating point
const DEFAULT_EVM_BALANCE = 1_000_000_000n; // 1000 USDC (6 decimals)
// BigInt: gas price in wei
const DEFAULT_GAS_PRICE = 1_000_000_000n; // 1 gwei
// BigInt: gas estimate for ERC20 transfer
const DEFAULT_GAS_ESTIMATE = 65_000n;

/**
 * Creates a mock EVM public client with configurable responses.
 * Satisfies the EvmPublicClient interface used by EvmAdapter.
 */
export function createMockEvmClient(config: MockEvmClientConfig = {}): EvmPublicClient {
  const {
    behavior = 'success',
    balance = DEFAULT_EVM_BALANCE,
    gasPrice = DEFAULT_GAS_PRICE,
    gasEstimate = DEFAULT_GAS_ESTIMATE,
    timeoutMs = 5000,
  } = config;

  return {
    async readContract(_params) {
      await applyBehavior(behavior, timeoutMs);
      // BigInt: returns token balance in smallest unit
      return balance;
    },
    async getGasPrice() {
      await applyBehavior(behavior, timeoutMs);
      // BigInt: gas price in wei
      return gasPrice;
    },
    async estimateGas(_params) {
      await applyBehavior(behavior, timeoutMs);
      // BigInt: gas estimate in gas units
      return gasEstimate;
    },
  };
}

// ─── Stellar Mock Client ───────────────────────────────────────────────────

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

/** Minimal interface for Stellar RPC operations. */
export interface StellarRpcClient {
  getAccount(accountId: string): Promise<StellarAccountResponse>;
  getFeeStats(): Promise<StellarFeeStats>;
}

/** Configuration for the mock Stellar server. */
export interface MockStellarServerConfig {
  readonly behavior?: MockBehavior;
  /** Balance as string (Stellar native format, e.g. "1000.0000000"). */
  readonly balance?: string;
  readonly baseFee?: string;
  readonly p50Fee?: string;
  readonly assetCode?: string;
  readonly assetIssuer?: string;
  readonly timeoutMs?: number;
}

/**
 * Creates a mock Stellar RPC client with configurable responses.
 */
export function createMockStellarServer(
  config: MockStellarServerConfig = {},
): StellarRpcClient {
  const {
    behavior = 'success',
    balance = '1000.0000000',
    baseFee = '100',
    p50Fee = '200',
    assetCode = 'USDC',
    assetIssuer = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    timeoutMs = 5000,
  } = config;

  return {
    async getAccount(_accountId: string) {
      await applyBehavior(behavior, timeoutMs);
      return {
        balances: [
          {
            asset_type: 'credit_alphanum4',
            asset_code: assetCode,
            asset_issuer: assetIssuer,
            balance,
          },
          {
            asset_type: 'native',
            balance: '100.0000000',
          },
        ],
      };
    },
    async getFeeStats() {
      await applyBehavior(behavior, timeoutMs);
      return {
        fee_charged: { p50: p50Fee },
        last_ledger_base_fee: baseFee,
      };
    },
  };
}

// ─── Solana Mock Client ────────────────────────────────────────────────────

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

/** Minimal interface for Solana RPC operations. */
export interface SolanaRpcClient {
  getTokenAccountBalance(address: string): Promise<SolanaTokenBalanceResponse>;
  getTokenAccountsByOwner(
    owner: string,
    filter: { readonly mint: string },
  ): Promise<SolanaTokenAccountsResponse>;
  getRecentPrioritizationFees(): Promise<readonly SolanaPriorityFee[]>;
}

/** Configuration for the mock Solana connection. */
export interface MockSolanaConnectionConfig {
  readonly behavior?: MockBehavior;
  /** Balance as string (lamport amount for SPL token). */
  readonly balance?: string;
  readonly decimals?: number;
  readonly tokenAccountPubkey?: string;
  readonly priorityFees?: readonly number[];
  readonly timeoutMs?: number;
}

/**
 * Creates a mock Solana RPC client with configurable responses.
 */
export function createMockSolanaConnection(
  config: MockSolanaConnectionConfig = {},
): SolanaRpcClient {
  const {
    behavior = 'success',
    balance = '1000000000',
    decimals = 6,
    tokenAccountPubkey = 'TokenAccountPubkey111111111111111111111111111',
    priorityFees = [100, 200, 150, 300, 250],
    timeoutMs = 5000,
  } = config;

  return {
    async getTokenAccountBalance(_address: string) {
      await applyBehavior(behavior, timeoutMs);
      return {
        value: { amount: balance, decimals },
      };
    },
    async getTokenAccountsByOwner(
      _owner: string,
      _filter: { readonly mint: string },
    ) {
      await applyBehavior(behavior, timeoutMs);
      return {
        value: [{ pubkey: tokenAccountPubkey }],
      };
    },
    async getRecentPrioritizationFees() {
      await applyBehavior(behavior, timeoutMs);
      return priorityFees.map((fee) => ({ prioritizationFee: fee }));
    },
  };
}

// ─── Mock Signer ───────────────────────────────────────────────────────────

/** Configuration for the mock signer. */
export interface MockSignerConfig {
  readonly address?: string;
  readonly behavior?: MockBehavior;
  readonly signature?: string;
}

const DEFAULT_SIGNER_ADDRESS = '0x1234567890123456789012345678901234567890';
const DEFAULT_SIGNATURE =
  '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab';

/**
 * Creates a mock Signer that satisfies the Signer interface.
 * INV-1: The mock signer has no private key properties — same as production.
 */
export function createMockSigner(config: MockSignerConfig = {}): Signer {
  const {
    address = DEFAULT_SIGNER_ADDRESS,
    behavior = 'success',
    signature = DEFAULT_SIGNATURE,
  } = config;

  return {
    address,
    async sign(_data: Uint8Array): Promise<Uint8Array> {
      if (behavior === 'error') {
        throw new Error('Mock signing failed');
      }
      const bytes = new Uint8Array(signature.length);
      for (let i = 0; i < signature.length; i++) {
        bytes[i] = signature.charCodeAt(i);
      }
      return bytes;
    },
    async signTypedData(_typedData: Record<string, unknown>): Promise<string> {
      if (behavior === 'error') {
        throw new Error('Mock signTypedData failed');
      }
      return signature;
    },
  };
}

// ─── Behavior Helpers ──────────────────────────────────────────────────────

// Declare setTimeout to avoid requiring @types/node or DOM lib
declare function setTimeout(callback: () => void, ms: number): unknown;

/**
 * Rejects a promise after a delay, used for timeout simulation. */
function delayReject(reject: (reason: Error) => void, ms: number): void {
  setTimeout(() => reject(new Error('Mock RPC timeout')), ms);
}

/**
 * Applies the configured behavior to a mock RPC call.
 * - success: resolves immediately
 * - error: throws an RPC error
 * - timeout: rejects after timeoutMs
 * - malformed: returns without throwing but data will be undefined/null
 */
async function applyBehavior(behavior: MockBehavior, timeoutMs: number): Promise<void> {
  switch (behavior) {
    case 'success':
      return;
    case 'error':
      throw new Error('Mock RPC error: connection refused');
    case 'timeout':
      return new Promise<void>((_resolve, reject) => {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        delayReject(reject, timeoutMs);
      });
    case 'malformed':
      // Returns normally but with default values — callers may get unexpected data
      return;
  }
}
