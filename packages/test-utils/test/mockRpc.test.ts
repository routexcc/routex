import { describe, expect, it } from 'vitest';
import {
  createMockEvmClient,
  createMockSigner,
  createMockSolanaConnection,
  createMockStellarServer,
} from '../src/mockRpc.js';

describe('mockRpc', () => {
  it('creates an EVM client with success responses and configurable values', async () => {
    const evm = createMockEvmClient({
      balance: 123n,
      gasPrice: 456n,
      gasEstimate: 789n,
    });

    await expect(
      evm.readContract({
        address: '0x1111111111111111111111111111111111111111',
        abi: [],
        functionName: 'balanceOf',
        args: ['0x2222222222222222222222222222222222222222'],
      }),
    ).resolves.toBe(123n);
    await expect(evm.getGasPrice()).resolves.toBe(456n);
    await expect(
      evm.estimateGas({
        to: '0x3333333333333333333333333333333333333333',
      }),
    ).resolves.toBe(789n);
  });

  it('applies EVM error and timeout behavior', async () => {
    const errorClient = createMockEvmClient({ behavior: 'error' });
    await expect(errorClient.getGasPrice()).rejects.toThrow(
      'Mock RPC error: connection refused',
    );

    const timeoutClient = createMockEvmClient({ behavior: 'timeout', timeoutMs: 1 });
    await expect(timeoutClient.getGasPrice()).rejects.toThrow('Mock RPC timeout');
  });

  it('allows malformed EVM behavior to continue with returned defaults', async () => {
    const malformedClient = createMockEvmClient({ behavior: 'malformed', balance: 42n });
    await expect(
      malformedClient.readContract({
        address: '0x1111111111111111111111111111111111111111',
        abi: [],
        functionName: 'balanceOf',
        args: [],
      }),
    ).resolves.toBe(42n);
  });

  it('creates a Stellar server with expected account and fee responses', async () => {
    const stellar = createMockStellarServer({
      balance: '55.0000000',
      baseFee: '123',
      p50Fee: '456',
      assetCode: 'USDC',
      assetIssuer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    });

    await expect(stellar.getAccount('GTEST')).resolves.toEqual({
      balances: [
        {
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
          balance: '55.0000000',
        },
        {
          asset_type: 'native',
          balance: '100.0000000',
        },
      ],
    });
    await expect(stellar.getFeeStats()).resolves.toEqual({
      fee_charged: { p50: '456' },
      last_ledger_base_fee: '123',
    });
  });

  it('applies Stellar error and timeout behavior', async () => {
    const errorServer = createMockStellarServer({ behavior: 'error' });
    await expect(errorServer.getAccount('GTEST')).rejects.toThrow(
      'Mock RPC error: connection refused',
    );

    const timeoutServer = createMockStellarServer({ behavior: 'timeout', timeoutMs: 1 });
    await expect(timeoutServer.getFeeStats()).rejects.toThrow('Mock RPC timeout');
  });

  it('creates a Solana connection with token account and priority fee data', async () => {
    const solana = createMockSolanaConnection({
      balance: '7000000',
      decimals: 6,
      tokenAccountPubkey: 'Token11111111111111111111111111111111111111',
      priorityFees: [1, 2, 3],
    });

    await expect(solana.getTokenAccountBalance('tokenAcct')).resolves.toEqual({
      value: { amount: '7000000', decimals: 6 },
    });
    await expect(
      solana.getTokenAccountsByOwner('owner', { mint: 'mint' }),
    ).resolves.toEqual({
      value: [{ pubkey: 'Token11111111111111111111111111111111111111' }],
    });
    await expect(solana.getRecentPrioritizationFees()).resolves.toEqual([
      { prioritizationFee: 1 },
      { prioritizationFee: 2 },
      { prioritizationFee: 3 },
    ]);
  });

  it('applies Solana error and timeout behavior', async () => {
    const errorConnection = createMockSolanaConnection({ behavior: 'error' });
    await expect(errorConnection.getTokenAccountBalance('acct')).rejects.toThrow(
      'Mock RPC error: connection refused',
    );

    const timeoutConnection = createMockSolanaConnection({
      behavior: 'timeout',
      timeoutMs: 1,
    });
    await expect(timeoutConnection.getRecentPrioritizationFees()).rejects.toThrow(
      'Mock RPC timeout',
    );
  });

  it('creates a mock signer with deterministic address and signatures', async () => {
    const signer = createMockSigner({
      address: '0x9999999999999999999999999999999999999999',
      signature: 'sig',
    });

    expect(signer.address).toBe('0x9999999999999999999999999999999999999999');
    await expect(signer.signTypedData({ domain: 'test' })).resolves.toBe('sig');
    await expect(signer.sign(new Uint8Array([1, 2, 3]))).resolves.toEqual(
      new Uint8Array([115, 105, 103]),
    );
  });

  it('applies signer error behavior to both sign methods', async () => {
    const signer = createMockSigner({ behavior: 'error' });

    await expect(signer.sign(new Uint8Array([1]))).rejects.toThrow('Mock signing failed');
    await expect(signer.signTypedData({})).rejects.toThrow('Mock signTypedData failed');
  });
});
