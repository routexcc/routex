# Security Model

Routex is designed with a non-custodial, defense-in-depth security model. This document describes the fund safety guarantees and what Routex does and does not have access to.

## Core Principle: Non-Custodial

Routex **never** handles private keys. The entire architecture is built around the `Signer` interface:

```typescript
interface Signer {
  readonly address: string;
  sign(data: Uint8Array): Promise<Uint8Array>;
  signTypedData?(typedData: Record<string, unknown>): Promise<string>;
}
```

Your application provides a `Signer` implementation that holds the key internally. Routex calls `.sign()` or `.signTypedData()` and receives only the signature. It never accesses `.privateKey`, `.secretKey`, or `.mnemonic`.

## What Routex Sees

| Data | Access | Purpose |
|---|---|---|
| Public wallet address | Read-only | Balance queries, payment construction |
| Token balances | Read-only | Eligibility checks |
| Fee estimates | Read-only | Route scoring |
| Payment amounts | Read-only | Payload construction |
| Recipient addresses | Read-only | From 402 response, passed through to payload |

## What Routex Does NOT See

| Data | Why |
|---|---|
| Private keys | Never requested, never stored — `Signer` interface |
| Secret keys | Never requested, never stored |
| Mnemonics / seed phrases | Never requested, never stored |
| RPC API keys | Injected via adapter constructor, never logged |
| Credentials | Never included in error messages (INV-8) |

## Security Invariants

Every security-critical code path is annotated with an invariant reference:

| ID | Invariant | Enforcement |
|---|---|---|
| INV-1 | No private key access | `Signer` interface — no key properties exist |
| INV-2 | Recipient match | Payload recipient verified against 402 requirement |
| INV-3 | Amount match | Payload amount verified against 402 requirement (BigInt) |
| INV-4 | Chain ID match | Payload chain ID verified against selected chain |
| INV-5 | No silent failure | `RouteExhaustedError` with rejection reasons |
| INV-6 | Stale fee rejection | Fee estimates older than `maxFeeAgeMs` rejected |
| INV-7 | BigInt-only amounts | All token amounts use `bigint`, never `Number` |
| INV-8 | Safe error messages | No credentials, RPC URLs, or signer data in errors |
| INV-9 | Stateless router | No mutable module-level state |
| INV-10 | Graceful degradation | Errors thrown with context, never swallowed |

## BigInt Arithmetic

All token amounts use `bigint` to avoid floating-point precision errors:

```typescript
// CORRECT: BigInt arithmetic
const feeAmount = (totalAmount * 2n) / 10000n;

// WRONG: floating-point loses precision
const feeAmount = totalAmount * 0.0002; // NEVER
```

This eliminates an entire class of rounding bugs that could lead to incorrect payments.

## Error Message Sanitization

Error messages are automatically sanitized to prevent credential leaks:

- `PaymentConstructionError` redacts patterns matching known sensitive keys (rpcUrl, apiKey, etc.)
- Error output includes only: chain name, public address, amount, error code
- `JSON.stringify` is never called on signer or credential objects

## Adapter Security

Each chain adapter enforces security at the adapter level:

- **EVM (Base, Polygon)**: EIP-712 domain separator includes `chainId` and `verifyingContract`, preventing cross-chain replay
- **Stellar**: Payment operation envelopes are constructed with the correct network passphrase
- **Solana**: SPL token transfer instructions are constructed with the correct program ID

## Recommendations for Integrators

1. **Implement `Signer` carefully**: Your `Signer` implementation should hold the key in a secure enclave or hardware wallet when possible.
2. **Use testnet first**: Always test with Base Sepolia or other testnets before mainnet.
3. **Set `maxFeeAgeMs`**: Stale fees can lead to overpayment. 60 seconds is a safe default.
4. **Handle `RouteExhaustedError`**: Always have a fallback path when no route is available.
5. **Don't log `RouteResult`**: While Routex sanitizes its own errors, your logging code should also avoid logging signer objects.
