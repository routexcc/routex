# AGENTS.md — AI Agent Development Guide

This file provides context for AI coding agents working on the Routex codebase.

## Project Summary

Routex is a multi-chain settlement cost router for the x402 payment protocol. It selects the cheapest or fastest blockchain (Base, Polygon, Stellar, Solana) for each AI agent micropayment. Non-custodial, stateless, BigInt-safe.

## Repository Structure

```
routex/
├── packages/
│   ├── core/           — Router engine, types, strategies, fee oracle, balance manager
│   ├── chain-base/     — Base L2 adapter (EVM, viem) + shared EvmAdapter base class
│   ├── chain-polygon/  — Polygon adapter (EVM, viem, extends EvmAdapter)
│   ├── chain-stellar/  — Stellar adapter (@stellar/stellar-sdk)
│   ├── chain-solana/   — Solana adapter (@solana/web3.js)
│   ├── x402/           — x402 middleware wrapper
│   ├── cloud/          — Cloud SDK: CloudFeeOracle, TelemetryReporter, BatchClient
│   └── test-utils/     — Shared mocks, fixtures, test helpers (private)
├── docs/               — Markdown documentation (8 files)
├── .changeset/         — Changesets for versioning
└── .github/workflows/  — CI pipeline
```

## Build & Development Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Build all packages (tsup, dual CJS/ESM)
pnpm test             # Run all tests (vitest)
pnpm lint             # Lint (ESLint)
pnpm format           # Format (Prettier)
pnpm typecheck        # TypeScript type checking
pnpm changeset        # Create a changeset for versioning
```

## Tech Stack

- **Runtime**: Node.js >= 20
- **Language**: TypeScript >= 5.7, strict mode, ES2022 target
- **Package manager**: pnpm 9+ (monorepo workspaces)
- **Build**: tsup (dual CJS/ESM with .cjs/.mjs extensions)
- **Test**: vitest with >= 90% coverage target
- **Lint**: ESLint + Prettier (single quotes, semicolons, 100 char width)
- **Versioning**: changesets
- **CI**: GitHub Actions

## Architecture Decisions

### Routing Pipeline

Every `route()` call follows a 5-step pipeline:
1. **Parse** — extract candidates from accepted chains
2. **Filter** — remove ineligible (no adapter, stale fee, insufficient balance, excluded)
3. **Score** — apply routing strategy
4. **Select** — pick highest-scoring candidate, build payload
5. **Verify** — enforce security invariants (recipient, amount, chain ID)

### Key Design Patterns

- **Factory functions**: `createRouter()`, `createBaseAdapter()`, etc.
- **Strategy pattern**: routing strategies are pure functions `(RouteOption[]) => RouteOption[]`
- **Interface-driven**: `ChainAdapter`, `FeeOracle`, `Signer` are all interfaces
- **Parallel queries**: `Promise.allSettled` for multi-chain balance/fee queries
- **Single barrel export**: each package has one `index.ts` entry point

### Non-Custodial Design

The `Signer` interface exposes only `.sign()` and `.signTypedData()`. Routex never accesses `.privateKey`, `.secretKey`, or `.mnemonic`. This is enforced by design and tested.

## Critical Rules

### Must Follow

1. **Never handle private keys** — use the `Signer` interface, call `.sign()` only
2. **BigInt for all token amounts** — no `Number`, `parseFloat`, or `parseInt` for monetary values
3. **Stateless router** — no mutable module-level state, no singletons
4. **Typed errors only** — never throw raw `Error` or strings; use classes from `errors.ts`
5. **Strict TypeScript** — `strict: true`, zero `any` in public API, no `@ts-ignore`
6. **Graceful degradation** — throw with context, never swallow errors silently

### Error Messages

- Include: chain name, public wallet address, amount, error code
- Exclude: signer objects, credentials, RPC API keys, private keys

### Security Invariants (INV-1 through INV-10)

Every security-critical code path must reference its invariant ID:

| ID     | Rule                                                      |
|--------|-----------------------------------------------------------|
| INV-1  | No private key access                                     |
| INV-2  | Recipient matches 402 payTo                               |
| INV-3  | Amount matches 402 requirement (BigInt)                    |
| INV-4  | Chain ID matches selected adapter                         |
| INV-5  | No silent failure — RouteExhaustedError with rejections   |
| INV-6  | Stale fees rejected (maxFeeAgeMs)                         |
| INV-7  | BigInt-only token arithmetic                              |
| INV-8  | No credentials in error messages                          |
| INV-9  | Stateless routing                                         |
| INV-10 | Graceful degradation — caller can always fall back        |

### Code Annotations

```typescript
// INV-2: recipient in payload must match recipient in 402 requirement
// BigInt: token amounts must never use floating point
```

## Coding Conventions

- **Naming**: PascalCase (types/classes), camelCase (functions/variables), UPPER_SNAKE (constants)
- **Exports**: single `index.ts` barrel per package, no deep imports
- **Async**: `async/await` only, never raw `.then()` chains
- **Immutability**: prefer `readonly` fields, `as const` for literals
- **Testing**: `*.test.ts` in `test/` directory mirroring `src/` structure

## Commit Messages

```
type(scope): description

feat(core): add balanced routing strategy
fix(chain-base): correct chain ID in EIP-712 domain separator [INV-4]
test(core): add stale fee rejection test [INV-6]
```

Types: `feat`, `fix`, `test`, `docs`, `chore`, `refactor`, `perf`
Scopes: `core`, `chain-base`, `chain-stellar`, `chain-solana`, `chain-polygon`, `x402`, `cloud`

## Package Dependency Graph

```
@routexcc/core (no external deps)
  ├── @routexcc/cloud (+ ws)
  ├── @routexcc/chain-base
  │   └── @routexcc/chain-polygon
  ├── @routexcc/chain-stellar
  ├── @routexcc/chain-solana
  ├── @routexcc/x402
  └── @routexcc/test-utils (private)
```

## Public API Surface

### Core Exports

```typescript
// Factory
createRouter(config: RouteConfig): Router

// Classes
LocalFeeOracle, BalanceManager, RouteSelector

// Strategy functions
cheapest, fastest, balanced, custom

// Errors
RoutexError, RouteExhaustedError, StaleFeesError, InsufficientBalanceError, PaymentConstructionError

// Types (all readonly)
ChainId, RouteConfig, PaymentRequirement, AcceptedPayment, RouteResult,
PaymentPayload, FeeEstimate, FeeConfidence, RouteOption, TokenBalance,
Signer, ChainAdapter, FeeOracle, RoutingStrategy, CustomStrategy,
RejectionReason, RejectionCode
```

### Chain Adapter Exports

```typescript
// @routexcc/chain-base
createBaseAdapter, EvmAdapter

// @routexcc/chain-polygon
createPolygonAdapter

// @routexcc/chain-stellar
createStellarAdapter, StellarAdapter

// @routexcc/chain-solana
createSolanaAdapter, SolanaAdapter
```

### Cloud Exports

```typescript
CloudFeeOracle, TelemetryReporter, BatchClient
calculateSavings, extractTelemetryEvent
```

### x402 Export

```typescript
routexMiddleware(config: RoutexMiddlewareConfig): RoutexMiddleware
```
