/**
 * Base chain adapter — EVM adapter configured for Base (L2).
 * Chain ID: 8453 (mainnet), 84532 (Sepolia testnet).
 * Finality: ~2000ms.
 */

import { EvmAdapter, type EvmPublicClient } from './EvmAdapter.js';

/** Base chain network identifiers. */
const BASE_MAINNET_CHAIN_ID = 8453;
const BASE_TESTNET_CHAIN_ID = 84532;

/** Base finality ~2 seconds (L2 block time). */
const BASE_FINALITY_MS = 2000;

/** Configuration for BaseAdapter. */
export interface BaseAdapterConfig {
  /** Injected public client for RPC calls. */
  readonly publicClient: EvmPublicClient;
  /** Native token (ETH) price in USD (6-decimal precision bigint). */
  // BigInt: token amounts must never use floating point
  readonly nativeTokenPriceUsd: bigint;
  /** Use testnet chain ID (84532) instead of mainnet (8453). */
  readonly testnet?: boolean;
}

/**
 * Creates a BaseAdapter — an EvmAdapter pre-configured for the Base chain.
 */
export function createBaseAdapter(config: BaseAdapterConfig): EvmAdapter {
  return new EvmAdapter({
    chainId: 'base',
    networkChainId: config.testnet ? BASE_TESTNET_CHAIN_ID : BASE_MAINNET_CHAIN_ID,
    finalityMs: BASE_FINALITY_MS,
    publicClient: config.publicClient,
    nativeTokenPriceUsd: config.nativeTokenPriceUsd,
  });
}

export { BASE_MAINNET_CHAIN_ID, BASE_TESTNET_CHAIN_ID, BASE_FINALITY_MS };
