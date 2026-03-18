import { describe, it, expect, vi } from 'vitest';
import { PaymentConstructionError, type AcceptedPayment, type Signer } from '@routexcc/core';
import { createMockEvmClient } from '@routexcc/test-utils';
import {
  BASE_MAINNET_CHAIN_ID,
  BASE_TESTNET_CHAIN_ID,
  BASE_FINALITY_MS,
  createBaseAdapter,
  EvmAdapter,
} from '../src/index.js';

const PAYMENT: AcceptedPayment = {
  chainId: 'base',
  payTo: '0x2222222222222222222222222222222222222222',
  amount: 1_500_000n,
  token: '0x3333333333333333333333333333333333333333',
};

function makeTypedDataSigner(signTypedData: Signer['signTypedData']): Signer {
  return {
    address: '0x1111111111111111111111111111111111111111',
    async sign(_data: Uint8Array): Promise<Uint8Array> {
      return new Uint8Array([1, 2, 3]);
    },
    signTypedData,
  };
}

describe('@routexcc/chain-base', () => {
  it('exports public adapter surface', () => {
    expect(typeof EvmAdapter).toBe('function');
    expect(typeof createBaseAdapter).toBe('function');
    expect(BASE_MAINNET_CHAIN_ID).toBe(8453);
    expect(BASE_TESTNET_CHAIN_ID).toBe(84532);
    expect(BASE_FINALITY_MS).toBe(2000);
  });

  it('reads ERC20 balance via injected public client', async () => {
    const adapter = createBaseAdapter({
      publicClient: createMockEvmClient({ balance: 42_000_000n }),
      nativeTokenPriceUsd: 3_000_000_000n,
    });

    const result = await adapter.getBalance(
      '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      PAYMENT.token,
    );

    expect(result.chainId).toBe('base');
    expect(result.balance).toBe(42_000_000n);
    expect(result.token).toBe(PAYMENT.token);
  });

  it('estimates fee with bigint-only arithmetic', async () => {
    const adapter = createBaseAdapter({
      publicClient: createMockEvmClient({
        gasPrice: 2_000_000_000n,
        gasEstimate: 50_000n,
      }),
      nativeTokenPriceUsd: 3_000_000_000n,
    });

    const fee = await adapter.estimateFee(PAYMENT);

    expect(fee.chainId).toBe('base');
    expect(fee.feeAmount).toBe(100_000_000_000_000n);
    expect(fee.feeUsd).toBe(300_000n);
    expect(fee.finalityMs).toBe(BASE_FINALITY_MS);
  });

  it('hardcodes mainnet chain ID 8453 in the EIP-712 domain', async () => {
    const adapter = createBaseAdapter({
      publicClient: createMockEvmClient(),
      nativeTokenPriceUsd: 2_000_000_000n,
    });
    const signTypedData = vi.fn<Signer['signTypedData']>().mockResolvedValue('0xmainnet');

    await adapter.buildPaymentPayload(PAYMENT, makeTypedDataSigner(signTypedData));

    const typedData = signTypedData.mock.calls[0]?.[0] as Record<string, unknown>;
    const domain = typedData.domain as Record<string, unknown>;
    expect(domain.chainId).toBe(BASE_MAINNET_CHAIN_ID);
  });

  it('hardcodes testnet chain ID 84532 in the EIP-712 domain', async () => {
    const adapter = createBaseAdapter({
      publicClient: createMockEvmClient(),
      nativeTokenPriceUsd: 2_000_000_000n,
      testnet: true,
    });
    const signTypedData = vi.fn<Signer['signTypedData']>().mockResolvedValue('0xtestnet');

    await adapter.buildPaymentPayload(PAYMENT, makeTypedDataSigner(signTypedData));

    const typedData = signTypedData.mock.calls[0]?.[0] as Record<string, unknown>;
    const domain = typedData.domain as Record<string, unknown>;
    expect(domain.chainId).toBe(BASE_TESTNET_CHAIN_ID);
  });

  it('abuse: ignores spoofed chainId input and signs with hardcoded domain chainId', async () => {
    const adapter = createBaseAdapter({
      publicClient: createMockEvmClient(),
      nativeTokenPriceUsd: 2_000_000_000n,
    });
    const signTypedData = vi.fn<Signer['signTypedData']>().mockResolvedValue('0xmainnet');
    const spoofedPayment: AcceptedPayment = {
      ...PAYMENT,
      extra: { chainId: '1', domainChainId: '1' },
    };

    await adapter.buildPaymentPayload(spoofedPayment, makeTypedDataSigner(signTypedData));

    const typedData = signTypedData.mock.calls[0]?.[0] as Record<string, unknown>;
    const domain = typedData.domain as Record<string, unknown>;
    expect(domain.chainId).toBe(BASE_MAINNET_CHAIN_ID);
  });

  it('builds payload that preserves recipient and amount', async () => {
    const adapter = createBaseAdapter({
      publicClient: createMockEvmClient(),
      nativeTokenPriceUsd: 2_000_000_000n,
    });
    const signer = makeTypedDataSigner(async () => '0xsigned');

    const payload = await adapter.buildPaymentPayload(PAYMENT, signer);

    expect(payload.chainId).toBe('base');
    expect(payload.to).toBe(PAYMENT.payTo);
    expect(payload.amount).toBe(PAYMENT.amount);
    expect(payload.data).toBe('0xsigned');
  });

  it('rejects signer without signTypedData', async () => {
    const adapter = createBaseAdapter({
      publicClient: createMockEvmClient(),
      nativeTokenPriceUsd: 2_000_000_000n,
    });
    const signer: Signer = {
      address: '0x1111111111111111111111111111111111111111',
      async sign(_data: Uint8Array): Promise<Uint8Array> {
        return new Uint8Array([1]);
      },
    };

    await expect(adapter.buildPaymentPayload(PAYMENT, signer)).rejects.toBeInstanceOf(
      PaymentConstructionError,
    );
  });

  it('wraps signer exceptions as PaymentConstructionError', async () => {
    const adapter = createBaseAdapter({
      publicClient: createMockEvmClient(),
      nativeTokenPriceUsd: 2_000_000_000n,
    });
    const signer = makeTypedDataSigner(async () => {
      throw new Error('hardware wallet disconnected');
    });

    await expect(adapter.buildPaymentPayload(PAYMENT, signer)).rejects.toThrow(
      'hardware wallet disconnected',
    );
  });

  it('maps non-Error signer failures to Unknown signing error', async () => {
    const adapter = createBaseAdapter({
      publicClient: createMockEvmClient(),
      nativeTokenPriceUsd: 2_000_000_000n,
    });
    const signer = makeTypedDataSigner(async () => {
      throw 'raw-failure';
    });

    await expect(adapter.buildPaymentPayload(PAYMENT, signer)).rejects.toThrow(
      'Unknown signing error',
    );
  });

  it('mock RPC timeout propagates as an error (no crash)', async () => {
    const adapter = createBaseAdapter({
      publicClient: createMockEvmClient({ behavior: 'timeout', timeoutMs: 1 }),
      nativeTokenPriceUsd: 2_000_000_000n,
    });

    await expect(adapter.estimateFee(PAYMENT)).rejects.toThrow(/timeout/i);
  });

  it('mock RPC 500/error propagates as an error (no crash)', async () => {
    const adapter = createBaseAdapter({
      publicClient: createMockEvmClient({ behavior: 'error' }),
      nativeTokenPriceUsd: 2_000_000_000n,
    });

    await expect(adapter.getBalance('0xA', PAYMENT.token)).rejects.toThrow(/rpc error/i);
  });

  it('malformed RPC response propagates as an error (no crash)', async () => {
    const adapter = createBaseAdapter({
      publicClient: {
        async readContract(): Promise<unknown> {
          return 1n;
        },
        async getGasPrice(): Promise<bigint> {
          return undefined as unknown as bigint;
        },
        async estimateGas(): Promise<bigint> {
          return 21_000n;
        },
      },
      nativeTokenPriceUsd: 2_000_000_000n,
    });

    await expect(adapter.estimateFee(PAYMENT)).rejects.toThrow();
  });

  it('returns configured finality', () => {
    const adapter = createBaseAdapter({
      publicClient: createMockEvmClient(),
      nativeTokenPriceUsd: 2_000_000_000n,
    });

    expect(adapter.getFinality()).toBe(BASE_FINALITY_MS);
  });
});
