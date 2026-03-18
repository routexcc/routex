/**
 * Polygon chain adapter — EVM adapter configured for Polygon PoS.
 * Chain ID: 137 (mainnet), 80002 (Amoy testnet).
 * Finality: ~2000ms.
 * Shares EvmAdapter base class with Base adapter.
 */

import { EvmAdapter, type EvmPublicClient } from '@routexcc/chain-base';

/** Polygon chain network identifiers. */
const POLYGON_MAINNET_CHAIN_ID = 137;
const POLYGON_TESTNET_CHAIN_ID = 80002;

/** Polygon finality ~2 seconds. */
const POLYGON_FINALITY_MS = 2000;

/** Configuration for PolygonAdapter. */
export interface PolygonAdapterConfig {
  /** Injected public client for RPC calls. */
  readonly publicClient: EvmPublicClient;
  /** Native token (MATIC/POL) price in USD (6-decimal precision bigint). */
  // BigInt: token amounts must never use floating point
  readonly nativeTokenPriceUsd: bigint;
  /** Use testnet chain ID (80002 Amoy) instead of mainnet (137). */
  readonly testnet?: boolean;
}

/**
 * Creates a PolygonAdapter — an EvmAdapter pre-configured for the Polygon chain.
 */
export function createPolygonAdapter(config: PolygonAdapterConfig): EvmAdapter {
  return new EvmAdapter({
    chainId: 'polygon',
    networkChainId: config.testnet ? POLYGON_TESTNET_CHAIN_ID : POLYGON_MAINNET_CHAIN_ID,
    finalityMs: POLYGON_FINALITY_MS,
    publicClient: config.publicClient,
    nativeTokenPriceUsd: config.nativeTokenPriceUsd,
  });
}

export {
  POLYGON_MAINNET_CHAIN_ID,
  POLYGON_TESTNET_CHAIN_ID,
  POLYGON_FINALITY_MS,
};
