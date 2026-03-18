/**
 * Shared test fixtures for Routex adapter tests.
 * Provides deterministic addresses, tokens, and payment objects.
 */

import type { AcceptedPayment, ChainId } from '@routexcc/core';

// ─── Addresses ─────────────────────────────────────────────────────────────

/** Well-known test addresses (never real keys — INV-1). */
export const ADDRESSES = {
  /** Generic sender address for EVM chains. */
  evmSender: '0x1111111111111111111111111111111111111111',
  /** Generic recipient address for EVM chains. */
  evmRecipient: '0x2222222222222222222222222222222222222222',
  /** Stellar sender public key. */
  stellarSender: 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI',
  /** Stellar recipient public key. */
  stellarRecipient: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEBD9AFZQ7TM4JRS9A',
  /** Solana sender public key. */
  solanaSender: '11111111111111111111111111111111',
  /** Solana recipient public key. */
  solanaRecipient: '22222222222222222222222222222222',
} as const;

// ─── Token Addresses ───────────────────────────────────────────────────────

/** USDC contract/mint addresses per chain. */
export const USDC_ADDRESSES: Readonly<Record<ChainId, string>> = {
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  polygon: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  stellar: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  solana: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
};

// ─── Chain IDs ─────────────────────────────────────────────────────────────

/** EVM network chain IDs. */
export const EVM_CHAIN_IDS = {
  base: { mainnet: 8453, testnet: 84532 },
  polygon: { mainnet: 137, testnet: 80002 },
} as const;

// ─── Payment Amounts ───────────────────────────────────────────────────────

// BigInt: token amounts must never use floating point
/** Standard test payment amount: 10 USDC (6 decimals). */
export const STANDARD_AMOUNT = 10_000_000n;
/** Large test payment amount: 10000 USDC (6 decimals). */
export const LARGE_AMOUNT = 10_000_000_000n;
/** Zero amount for edge case testing. */
export const ZERO_AMOUNT = 0n;

// ─── Pre-built AcceptedPayment Fixtures ────────────────────────────────────

/** Standard payment on Base chain. */
export const BASE_PAYMENT: AcceptedPayment = {
  chainId: 'base',
  payTo: ADDRESSES.evmRecipient,
  // BigInt: token amounts must never use floating point
  amount: STANDARD_AMOUNT,
  token: USDC_ADDRESSES.base,
};

/** Standard payment on Polygon chain. */
export const POLYGON_PAYMENT: AcceptedPayment = {
  chainId: 'polygon',
  payTo: ADDRESSES.evmRecipient,
  // BigInt: token amounts must never use floating point
  amount: STANDARD_AMOUNT,
  token: USDC_ADDRESSES.polygon,
};

/** Standard payment on Stellar chain. */
export const STELLAR_PAYMENT: AcceptedPayment = {
  chainId: 'stellar',
  payTo: ADDRESSES.stellarRecipient,
  // BigInt: token amounts must never use floating point
  amount: STANDARD_AMOUNT,
  token: USDC_ADDRESSES.stellar,
};

/** Standard payment on Solana chain. */
export const SOLANA_PAYMENT: AcceptedPayment = {
  chainId: 'solana',
  payTo: ADDRESSES.solanaRecipient,
  // BigInt: token amounts must never use floating point
  amount: STANDARD_AMOUNT,
  token: USDC_ADDRESSES.solana,
};
