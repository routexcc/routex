import type { RouteResult } from '@routexcc/core';

/**
 * Configuration for the BatchClient.
 */
export interface BatchClientConfig {
  /** Cloud API key for authentication (rtx_ prefix). */
  readonly apiKey: string;
  /** Settlement service endpoint URL. */
  readonly endpoint?: string;
}

/**
 * A signed EIP-712 batch intent ready for submission.
 * The agent signs this with their wallet before calling submit().
 */
export interface BatchIntent {
  /** Agent's wallet address (signer). */
  readonly from: string;
  /** Payment recipient address. */
  readonly to: string;
  /** USDC amount in smallest unit (6 decimals). BigInt as string. */
  readonly amount: string;
  /** USDC contract address on the target chain. */
  readonly token: string;
  /** Monotonic nonce per (from, to) pair. BigInt as string. */
  readonly nonce: string;
  /** Unix timestamp — intent expires after this. BigInt as string. */
  readonly deadline: string;
  /** EVM chain ID (8453 = Base, 137 = Polygon). */
  readonly chainId: number;
  /** EIP-712 signature V component. */
  readonly v: number;
  /** EIP-712 signature R component (hex). */
  readonly r: string;
  /** EIP-712 signature S component (hex). */
  readonly s: string;
}

export interface BatchSubmitResult {
  readonly status: 'accepted' | 'error';
  readonly from?: string;
  readonly nonce?: string;
  readonly chainId?: number;
  readonly error?: string;
}

export interface BatchClientHandle {
  /**
   * Submit a signed batch intent for settlement.
   * The intent must be EIP-712 signed by the agent's wallet.
   */
  submitIntent(intent: BatchIntent): Promise<BatchSubmitResult>;

  /**
   * Convenience: extract intent fields from a RouteResult and submit.
   * Requires the caller to provide from, nonce, deadline, and signature
   * since RouteResult doesn't contain these.
   */
  submit(
    result: RouteResult,
    sigData: {
      from: string;
      nonce: string;
      deadline: string;
      v: number;
      r: string;
      s: string;
    },
  ): Promise<BatchSubmitResult>;
}

const DEFAULT_ENDPOINT = 'https://oracle.routex.dev';

// EVM chain IDs that support batch settlement (Permit2)
const BATCH_CHAIN_IDS: Record<string, number> = {
  base: 8453,
  polygon: 137,
};

/**
 * Batch settlement client.
 * Submits EIP-712 signed payment intents to the settlement engine
 * for batching into single on-chain Permit2 multicall transactions.
 */
export function BatchClient(config: BatchClientConfig): BatchClientHandle {
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;

  function submitUrl(): string {
    return `${endpoint}/v1/batch/submit`;
  }

  async function submitIntent(intent: BatchIntent): Promise<BatchSubmitResult> {
    try {
      const res = await fetch(submitUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(intent),
      });

      const body = (await res.json()) as Record<string, unknown>;

      if (!res.ok) {
        return {
          status: 'error',
          error: (body.error as string) ?? `HTTP ${res.status}`,
        };
      }

      return {
        status: 'accepted',
        from: body.from as string,
        nonce: body.nonce as string,
        chainId: body.chainId as number,
      };
    } catch (err) {
      return {
        status: 'error',
        error: err instanceof Error ? err.message : 'network error',
      };
    }
  }

  return {
    submitIntent,

    async submit(result, sigData): Promise<BatchSubmitResult> {
      const evmChainId = BATCH_CHAIN_IDS[result.chainId];
      if (!evmChainId) {
        return {
          status: 'error',
          error: `chain ${result.chainId} does not support batch settlement`,
        };
      }

      const intent: BatchIntent = {
        from: sigData.from,
        to: result.payload.to,
        amount: result.payload.amount.toString(),
        token: result.payload.token,
        nonce: sigData.nonce,
        deadline: sigData.deadline,
        chainId: evmChainId,
        v: sigData.v,
        r: sigData.r,
        s: sigData.s,
      };

      return submitIntent(intent);
    },
  };
}
