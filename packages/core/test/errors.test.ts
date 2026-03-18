import { describe, it, expect } from 'vitest';
import {
  RoutexError,
  RouteExhaustedError,
  StaleFeesError,
  InsufficientBalanceError,
  PaymentConstructionError,
} from '../src/errors.js';

describe('errors', () => {
  describe('RouteExhaustedError', () => {
    it('includes rejection details in message', () => {
      // INV-5: No eligible route → RouteExhaustedError (never silent drop)
      const error = new RouteExhaustedError([
        { chainId: 'base', reason: 'Insufficient balance', code: 'INSUFFICIENT_BALANCE' },
        { chainId: 'stellar', reason: 'Fee unavailable', code: 'FEE_UNAVAILABLE' },
      ]);
      expect(error).toBeInstanceOf(RoutexError);
      expect(error.code).toBe('ROUTE_EXHAUSTED');
      expect(error.message).toContain('base');
      expect(error.message).toContain('stellar');
      expect(error.rejections).toHaveLength(2);
      expect(error.name).toBe('RouteExhaustedError');
    });
  });

  describe('StaleFeesError', () => {
    it('includes chain and timing details', () => {
      // INV-6: Fee estimates older than maxFeeAgeMs are rejected
      const error = new StaleFeesError('polygon', 60000, 30000);
      expect(error).toBeInstanceOf(RoutexError);
      expect(error.code).toBe('STALE_FEES');
      expect(error.chainId).toBe('polygon');
      expect(error.ageMs).toBe(60000);
      expect(error.maxAgeMs).toBe(30000);
      expect(error.message).toContain('polygon');
      expect(error.message).toContain('60000');
      expect(error.message).toContain('30000');
    });
  });

  describe('InsufficientBalanceError', () => {
    it('uses bigint for amounts and includes chain details', () => {
      // BigInt: token amounts must never use floating point
      const error = new InsufficientBalanceError('base', 1000000n, 500000n);
      expect(error).toBeInstanceOf(RoutexError);
      expect(error.code).toBe('INSUFFICIENT_BALANCE');
      expect(error.chainId).toBe('base');
      expect(typeof error.required).toBe('bigint');
      expect(typeof error.available).toBe('bigint');
      expect(error.required).toBe(1000000n);
      expect(error.available).toBe(500000n);
      expect(error.message).toContain('base');
    });
  });

  describe('PaymentConstructionError', () => {
    it('includes chain, phase, and detail — never credentials (INV-8)', () => {
      // INV-8: Error messages contain only: chain, public address, amount, code
      const error = new PaymentConstructionError('solana', 'signing', 'Transaction too large');
      expect(error).toBeInstanceOf(RoutexError);
      expect(error.code).toBe('PAYMENT_CONSTRUCTION');
      expect(error.chainId).toBe('solana');
      expect(error.phase).toBe('signing');
      expect(error.detail).toBe('Transaction too large');
      expect(error.message).toContain('solana');
      expect(error.message).toContain('signing');
      expect(error.message).not.toContain('privateKey');
      expect(error.message).not.toContain('secretKey');
    });

    it('INV-8: serialized errors redact credential-like fields in detail text', () => {
      const tainted = new PaymentConstructionError(
        'base',
        'build',
        'rpcUrl=https://node.example apiKey=abc123 privateKey=0xdeadbeef mnemonic=seed phrase',
      );

      const serialized = JSON.stringify(tainted);

      expect(serialized).not.toMatch(/rpcUrl/i);
      expect(serialized).not.toMatch(/apiKey/i);
      expect(serialized).not.toMatch(/privateKey/i);
      expect(serialized).not.toMatch(/secretKey/i);
      expect(serialized).not.toMatch(/mnemonic/i);
    });
  });

  describe('error hierarchy', () => {
    it('all error classes extend RoutexError and Error', () => {
      const errors = [
        new RouteExhaustedError([]),
        new StaleFeesError('base', 100, 50),
        new InsufficientBalanceError('base', 100n, 50n),
        new PaymentConstructionError('base', 'build', 'test'),
      ];
      for (const error of errors) {
        expect(error).toBeInstanceOf(RoutexError);
        expect(error).toBeInstanceOf(Error);
      }
    });
  });
});
