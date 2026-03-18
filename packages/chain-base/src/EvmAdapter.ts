/**
 * Shared EVM adapter base class for Base and Polygon chains.
 * Chain-specific differences (chain ID, finality, USDC address) are injected via config.
 */

import type {
  ChainId,
  ChainAdapter,
  AcceptedPayment,
  FeeEstimate,
  PaymentPayload,
  Signer,
  TokenBalance,
} from '@routexcc/core';
import { PaymentConstructionError } from '@routexcc/core';

// ─── EVM Public Client Interface ───────────────────────────────────────────

/**
 * Minimal interface matching viem's PublicClient for EVM read operations.
 * Adapters accept this interface via dependency injection for testability.
 */
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

// ─── EVM Adapter Configuration ─────────────────────────────────────────────

/** Configuration for an EVM chain adapter. */
export interface EvmAdapterConfig {
  /** Routex chain identifier. */
  readonly chainId: ChainId;
  /** EVM network chain ID (e.g. 8453 for Base mainnet). */
  readonly networkChainId: number;
  /** Expected finality time in milliseconds. */
  readonly finalityMs: number;
  /** Injected public client for RPC calls. */
  readonly publicClient: EvmPublicClient;
  /** Native token price in USD (6-decimal precision bigint, e.g. 2500_000000n = $2500). */
  // BigInt: token amounts must never use floating point
  readonly nativeTokenPriceUsd: bigint;
}

// ─── ERC20 ABI Fragment ────────────────────────────────────────────────────

const ERC20_BALANCE_OF_ABI: readonly Record<string, unknown>[] = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
];

// ─── EIP-712 Payment Type ──────────────────────────────────────────────────

const PAYMENT_TYPES = {
  Payment: [
    { name: 'to', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'token', type: 'address' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

// ─── Utility ───────────────────────────────────────────────────────────────

/** Encode ERC20 transfer calldata for gas estimation. */
function encodeErc20TransferData(to: string, amount: bigint): string {
  // Function selector: keccak256("transfer(address,uint256)") first 4 bytes
  const selector = 'a9059cbb';
  const paddedTo = to.slice(2).toLowerCase().padStart(64, '0');
  // BigInt: amount encoded as hex for calldata
  const paddedAmount = amount.toString(16).padStart(64, '0');
  return '0x' + selector + paddedTo + paddedAmount;
}

// ─── EvmAdapter ────────────────────────────────────────────────────────────

/**
 * Shared EVM adapter implementation.
 * Base and Polygon both extend or instantiate this class with chain-specific config.
 */
export class EvmAdapter implements ChainAdapter {
  readonly chainId: ChainId;
  private readonly networkChainId: number;
  private readonly finalityMs: number;
  private readonly publicClient: EvmPublicClient;
  // BigInt: native token price in USD (6-decimal precision)
  private readonly nativeTokenPriceUsd: bigint;

  constructor(config: EvmAdapterConfig) {
    this.chainId = config.chainId;
    this.networkChainId = config.networkChainId;
    this.finalityMs = config.finalityMs;
    this.publicClient = config.publicClient;
    this.nativeTokenPriceUsd = config.nativeTokenPriceUsd;
  }

  /**
   * Query ERC20 token balance via balanceOf().
   */
  async getBalance(address: string, token: string): Promise<TokenBalance> {
    // BigInt: readContract returns token balance in smallest unit
    const balance = (await this.publicClient.readContract({
      address: token,
      abi: ERC20_BALANCE_OF_ABI,
      functionName: 'balanceOf',
      args: [address],
    })) as bigint;

    return {
      chainId: this.chainId,
      token,
      // BigInt: token balance in smallest unit
      balance,
      timestamp: Date.now(),
    };
  }

  /**
   * Estimate transaction fee using eth_gasPrice + eth_estimateGas.
   * Converts gas cost to USD using the configured native token price.
   */
  async estimateFee(payment: AcceptedPayment): Promise<FeeEstimate> {
    const calldata = encodeErc20TransferData(payment.payTo, payment.amount);

    const [gasPrice, gasEstimate] = await Promise.all([
      this.publicClient.getGasPrice(),
      this.publicClient.estimateGas({
        to: payment.token,
        data: calldata,
      }),
    ]);

    // BigInt: gas cost in wei = gasPrice * gasEstimate
    const feeAmount = gasPrice * gasEstimate;

    // BigInt: convert wei to USD (6-decimal precision)
    // feeAmount is in wei (18 decimals), nativeTokenPriceUsd is 6 decimals
    // result = feeAmount * priceUsd / 10^18 → 6 decimal USD
    const feeUsd = (feeAmount * this.nativeTokenPriceUsd) / 10n ** 18n;

    return {
      chainId: this.chainId,
      // BigInt: fee in native token's smallest unit (wei)
      feeAmount,
      // BigInt: fee in USD with 6-decimal precision
      feeUsd,
      finalityMs: this.finalityMs,
      confidence: 'high',
      timestamp: Date.now(),
    };
  }

  /**
   * Construct a signed EIP-712 payment payload.
   * INV-1: Never accesses signer private keys — only calls signer.signTypedData().
   * INV-2: Recipient in payload matches recipient in payment requirement.
   * INV-4: Chain ID in EIP-712 domain matches this adapter's chain.
   */
  async buildPaymentPayload(
    payment: AcceptedPayment,
    signer: Signer,
  ): Promise<PaymentPayload> {
    // INV-1: No private key access — only use signer.signTypedData()
    if (!signer.signTypedData) {
      throw new PaymentConstructionError(
        this.chainId,
        'sign',
        'Signer does not support EIP-712 typed data signing',
      );
    }

    // INV-4: Chain ID in domain must match adapter's chain
    const domain = {
      name: 'Routex',
      version: '1',
      chainId: this.networkChainId,
      verifyingContract: payment.token,
    };

    const message = {
      to: payment.payTo,
      // BigInt: amount serialized for EIP-712
      amount: payment.amount.toString(),
      token: payment.token,
      nonce: Date.now().toString(),
    };

    let signature: string;
    try {
      signature = await signer.signTypedData({
        domain,
        types: PAYMENT_TYPES,
        primaryType: 'Payment',
        message,
      });
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : 'Unknown signing error';
      throw new PaymentConstructionError(this.chainId, 'sign', detail);
    }

    // INV-2: Recipient in payload must match payment requirement
    return {
      chainId: this.chainId,
      to: payment.payTo,
      // BigInt: token amount in smallest unit
      amount: payment.amount,
      token: payment.token,
      data: signature,
    };
  }

  /** Get expected finality time for this EVM chain. */
  getFinality(): number {
    return this.finalityMs;
  }
}
