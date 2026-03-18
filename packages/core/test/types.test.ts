import { describe, it, expect } from 'vitest';
import type {
  ChainId,
  RouteConfig,
  RoutingStrategy,
  CustomStrategy,
  PaymentRequirement,
  AcceptedPayment,
  FeeEstimate,
  FeeConfidence,
  FeeOracle,
  RouteOption,
  RouteResult,
  PaymentPayload,
  TokenBalance,
  Signer,
  ChainAdapter,
  RejectionReason,
  RejectionCode,
} from '@routexcc/core';

describe('types', () => {
  describe('ChainId', () => {
    it('accepts valid chain identifiers', () => {
      const chains: ChainId[] = ['base', 'stellar', 'solana', 'polygon'];
      expect(chains).toHaveLength(4);
    });
  });

  describe('AcceptedPayment', () => {
    it('uses bigint for amount', () => {
      const payment: AcceptedPayment = {
        chainId: 'base',
        payTo: '0x1234567890abcdef1234567890abcdef12345678',
        // BigInt: token amounts must never use floating point
        amount: 1000000n,
        token: '0xUSDC',
      };
      expect(typeof payment.amount).toBe('bigint');
    });
  });

  describe('FeeEstimate', () => {
    it('uses bigint for fee amounts', () => {
      const fee: FeeEstimate = {
        chainId: 'base',
        // BigInt: token amounts must never use floating point
        feeAmount: 500n,
        // BigInt: token amounts must never use floating point
        feeUsd: 100000n,
        finalityMs: 2000,
        confidence: 'high',
        timestamp: Date.now(),
      };
      expect(typeof fee.feeAmount).toBe('bigint');
      expect(typeof fee.feeUsd).toBe('bigint');
    });
  });

  describe('RouteOption', () => {
    it('uses bigint for balance', () => {
      const option: RouteOption = {
        chainId: 'stellar',
        payment: {
          chainId: 'stellar',
          payTo: 'GABCDEF',
          // BigInt: token amounts must never use floating point
          amount: 5000000n,
          token: 'USDC',
        },
        fee: {
          chainId: 'stellar',
          // BigInt: token amounts must never use floating point
          feeAmount: 100n,
          // BigInt: token amounts must never use floating point
          feeUsd: 50000n,
          finalityMs: 5000,
          confidence: 'medium',
          timestamp: Date.now(),
        },
        // BigInt: token amounts must never use floating point
        balance: 10000000n,
        score: 0.85,
      };
      expect(typeof option.balance).toBe('bigint');
    });
  });

  describe('PaymentPayload', () => {
    it('uses bigint for amount', () => {
      const payload: PaymentPayload = {
        chainId: 'solana',
        to: 'SoLaNaAdDrEsS',
        // BigInt: token amounts must never use floating point
        amount: 2000000n,
        token: 'USDC',
        data: '0xsigneddata',
      };
      expect(typeof payload.amount).toBe('bigint');
    });
  });

  describe('TokenBalance', () => {
    it('uses bigint for balance', () => {
      const tb: TokenBalance = {
        chainId: 'polygon',
        token: '0xUSDC',
        // BigInt: token amounts must never use floating point
        balance: 50000000n,
        timestamp: Date.now(),
      };
      expect(typeof tb.balance).toBe('bigint');
    });
  });

  describe('RejectionCode', () => {
    it('accepts all defined rejection codes', () => {
      const codes: RejectionCode[] = [
        'NO_ADAPTER',
        'INSUFFICIENT_BALANCE',
        'FEE_TOO_HIGH',
        'FINALITY_TOO_SLOW',
        'CHAIN_EXCLUDED',
        'STALE_FEE',
        'FEE_UNAVAILABLE',
      ];
      expect(codes).toHaveLength(7);
    });
  });

  describe('FeeConfidence', () => {
    it('accepts all confidence levels', () => {
      const levels: FeeConfidence[] = ['high', 'medium', 'low'];
      expect(levels).toHaveLength(3);
    });
  });

  describe('Signer', () => {
    it('exposes only address and sign methods — never private keys (INV-1)', () => {
      const signer: Signer = {
        address: '0xPublicAddress',
        sign: async (data: Uint8Array) => new Uint8Array(64),
      };
      // INV-1: No Routex function receives, stores, or returns a private key.
      expect(signer).not.toHaveProperty('privateKey');
      expect(signer).not.toHaveProperty('secretKey');
      expect(signer).not.toHaveProperty('mnemonic');
      expect(signer.address).toBe('0xPublicAddress');
    });
  });
});
