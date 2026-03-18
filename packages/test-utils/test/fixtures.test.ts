import { describe, expect, it } from 'vitest';
import {
  ADDRESSES,
  BASE_PAYMENT,
  EVM_CHAIN_IDS,
  LARGE_AMOUNT,
  POLYGON_PAYMENT,
  SOLANA_PAYMENT,
  STANDARD_AMOUNT,
  STELLAR_PAYMENT,
  USDC_ADDRESSES,
  ZERO_AMOUNT,
} from '../src/fixtures.js';

describe('fixtures', () => {
  it('exposes deterministic test addresses', () => {
    expect(ADDRESSES.evmSender).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(ADDRESSES.evmRecipient).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(ADDRESSES.stellarSender.startsWith('G')).toBe(true);
    expect(ADDRESSES.stellarRecipient.startsWith('G')).toBe(true);
    expect(ADDRESSES.solanaSender).toHaveLength(32);
    expect(ADDRESSES.solanaRecipient).toHaveLength(32);
  });

  it('contains chain-specific USDC token identifiers', () => {
    expect(USDC_ADDRESSES.base).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(USDC_ADDRESSES.polygon).toBe('0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359');
    expect(USDC_ADDRESSES.stellar).toContain('USDC:');
    expect(USDC_ADDRESSES.solana).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  });

  it('keeps chain id fixtures stable', () => {
    expect(EVM_CHAIN_IDS.base.mainnet).toBe(8453);
    expect(EVM_CHAIN_IDS.base.testnet).toBe(84532);
    expect(EVM_CHAIN_IDS.polygon.mainnet).toBe(137);
    expect(EVM_CHAIN_IDS.polygon.testnet).toBe(80002);
  });

  it('provides bigint amount fixtures', () => {
    expect(STANDARD_AMOUNT).toBe(10_000_000n);
    expect(LARGE_AMOUNT).toBe(10_000_000_000n);
    expect(ZERO_AMOUNT).toBe(0n);
    expect(typeof STANDARD_AMOUNT).toBe('bigint');
    expect(typeof LARGE_AMOUNT).toBe('bigint');
    expect(typeof ZERO_AMOUNT).toBe('bigint');
  });

  it('builds payment fixtures with expected chain, recipient, amount, and token', () => {
    expect(BASE_PAYMENT).toEqual({
      chainId: 'base',
      payTo: ADDRESSES.evmRecipient,
      amount: STANDARD_AMOUNT,
      token: USDC_ADDRESSES.base,
    });
    expect(POLYGON_PAYMENT).toEqual({
      chainId: 'polygon',
      payTo: ADDRESSES.evmRecipient,
      amount: STANDARD_AMOUNT,
      token: USDC_ADDRESSES.polygon,
    });
    expect(STELLAR_PAYMENT).toEqual({
      chainId: 'stellar',
      payTo: ADDRESSES.stellarRecipient,
      amount: STANDARD_AMOUNT,
      token: USDC_ADDRESSES.stellar,
    });
    expect(SOLANA_PAYMENT).toEqual({
      chainId: 'solana',
      payTo: ADDRESSES.solanaRecipient,
      amount: STANDARD_AMOUNT,
      token: USDC_ADDRESSES.solana,
    });
  });
});
