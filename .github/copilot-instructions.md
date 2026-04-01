# Copilot Instructions for Routex

## Project Context

Routex is a multi-chain settlement cost router for the x402 payment protocol. It routes AI agent micropayments to the cheapest or fastest blockchain across Base, Polygon, Stellar, and Solana.

## Critical Constraints

1. **Non-custodial**: Never access `.privateKey`, `.secretKey`, or `.mnemonic` on any object. Use the `Signer` interface — call `.sign()` or `.signTypedData()` only.

2. **BigInt for money**: All token amounts must use `bigint`. Never use `Number`, `parseFloat`, or `parseInt` for monetary values. Use bigint literals (`1000n`) and BigInt arithmetic.

3. **Stateless**: Each `route()` call is independent. No mutable module-level state. No singletons holding runtime data.

4. **Typed errors**: Never throw raw `Error` or strings. Use error classes from `packages/core/src/errors.ts`: `RouteExhaustedError`, `StaleFeesError`, `InsufficientBalanceError`, `PaymentConstructionError`.

5. **Strict TypeScript**: `strict: true`. Zero `any` in public API. No `@ts-ignore` without a linked issue.

6. **No silent failures**: If routing fails, throw a typed error with context. Never swallow exceptions.

## Code Style

- Single quotes, semicolons, 100 char line width, trailing commas
- PascalCase for types/classes/interfaces
- camelCase for functions/variables
- UPPER_SNAKE for constants
- `async/await` only — no `.then()` chains
- `readonly` on interface fields, `as const` for literal types
- Single `index.ts` barrel export per package

## Security Annotations

Mark security-critical code with invariant IDs:

```typescript
// INV-2: recipient must match 402 requirement
// BigInt: token amounts must never use floating point
```

## Error Messages

- Include: chain name, public wallet address, amount, error code
- Exclude: signer objects, credentials, RPC API keys, private keys
- Never call `JSON.stringify` on signer or credential objects

## Testing

- Framework: vitest
- Coverage: >= 90% per package
- Test files: `test/*.test.ts` mirroring `src/` structure
- Mock RPC calls — no live network in CI
- Shared fixtures in `packages/test-utils/`

## Architecture

- 5-step routing pipeline: parse, filter, score, select, verify
- Strategy functions are pure: `(RouteOption[]) => RouteOption[]`
- `Promise.allSettled` for parallel multi-chain queries
- Factory functions: `createRouter()`, `createBaseAdapter()`, etc.
- Base and Polygon share `EvmAdapter` base class

## Packages

| Package | Purpose |
|---------|---------|
| `@routexcc/core` | Router engine, types, strategies, oracle |
| `@routexcc/chain-base` | Base L2 adapter (EVM) |
| `@routexcc/chain-polygon` | Polygon adapter (EVM) |
| `@routexcc/chain-stellar` | Stellar adapter |
| `@routexcc/chain-solana` | Solana adapter |
| `@routexcc/x402` | x402 middleware |
| `@routexcc/cloud` | Cloud fee oracle, telemetry, batching |
| `@routexcc/test-utils` | Shared test mocks/fixtures |
