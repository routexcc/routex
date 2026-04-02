# Routex

[![CI](https://github.com/routexcc/routex/actions/workflows/ci.yml/badge.svg)](https://github.com/routexcc/routex/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@routexcc/core)](https://www.npmjs.com/package/@routexcc/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-green)](https://nodejs.org/)

**Multi-chain settlement cost router for the [x402 payment protocol](https://www.x402.org/).** Selects the cheapest or fastest blockchain for each AI agent micropayment — non-custodial, stateless, and BigInt-safe.

Built for developers integrating x402 payments into AI agents, wallets, and autonomous services.

---

## Why Routex?

When an AI agent receives a `402 Payment Required` response, it needs to pay — but which chain? Gas fees fluctuate, finality times vary, and balances are spread across networks. Routex evaluates all options in real time and picks the optimal chain automatically.

**Real cost impact:** A $0.10 USDC payment costs ~$0.001 on Base but ~$0.01 on Polygon — 10x difference. At 10,000 payments/day, that's **$90/day saved** by routing to the cheapest chain. Fees shift constantly; Routex checks every 30 seconds and picks the winner for each payment.

- Pay less by routing to the cheapest chain at the moment of payment
- Pay faster by routing to the chain with the lowest finality time
- Never touch private keys — Routex is fully non-custodial
- Drop in as x402 middleware with a single line of code

---

## Install

```bash
# Core router (required)
npm install @routexcc/core

# Chain adapters (install the ones you need)
npm install @routexcc/chain-base
npm install @routexcc/chain-stellar
npm install @routexcc/chain-solana
npm install @routexcc/chain-polygon

# x402 middleware (optional)
npm install @routexcc/x402
```

---

## Quickstart

```typescript
import { createRouter, LocalFeeOracle } from '@routexcc/core';
import { createBaseAdapter } from '@routexcc/chain-base';
import { createSolanaAdapter } from '@routexcc/chain-solana';

// 1. Configure chain adapters
const adapters = new Map([
  ['base', createBaseAdapter(viemClient)],
  ['solana', createSolanaAdapter(solanaConnection)],
]);

// 2. Create fee oracle
const feeOracle = new LocalFeeOracle({
  adapters,
  pollIntervalMs: 30_000,
  maxFeeAgeMs: 60_000,
});

// 3. Create router
const router = createRouter({
  adapters,
  feeOracle,
  strategy: 'cheapest',
  maxFeeAgeMs: 60_000,
});

// 4. Route a payment
const result = await router.route(paymentRequirement, signer);
console.log(result.chainId);  // 'base' or 'solana' — whichever is cheaper
console.log(result.payload);  // Signed payload ready for the facilitator
```

---

## x402 Middleware

Intercept `402 Payment Required` responses and route payments automatically:

```typescript
import { routexMiddleware } from '@routexcc/x402';

const middleware = routexMiddleware({
  routeConfig: { adapters, feeOracle, strategy: 'cheapest', maxFeeAgeMs: 60_000 },
  signer: mySigner,
  onRouteSelected: (result) => console.log(`Paying via ${result.chainId}`),
  onRouteFailed: (error) => console.error('Routing failed:', error),
});

// When you get a 402 response:
const parsed = middleware.parseResponse(402, responseBody);
if (parsed) {
  const { payload, chainId } = await middleware.handlePaymentRequired(parsed);
  // payload is ready to submit to the facilitator
}
```

---

## Routing Strategies

| Strategy | Optimizes For | Best When |
|---|---|---|
| `'cheapest'` | Lowest fee in USD | Cost-sensitive workloads, high volume |
| `'fastest'` | Lowest finality time | Time-critical payments, real-time agents |
| `'balanced'` | 60% cost / 40% speed | General-purpose, default choice |
| `custom` | Your scoring function | Domain-specific requirements |

### Custom Strategy

```typescript
const router = createRouter({
  adapters,
  feeOracle,
  strategy: {
    type: 'custom',
    scorer: (options) => {
      // Score and sort candidates however you want
      return [...options].sort((a, b) => {
        // Example: prefer Base, then sort by fee
        if (a.chainId === 'base' && b.chainId !== 'base') return -1;
        if (b.chainId === 'base' && a.chainId !== 'base') return 1;
        return Number(a.fee.feeUsd - b.fee.feeUsd);
      });
    },
  },
  maxFeeAgeMs: 60_000,
});
```

---

## Configuration

```typescript
interface RouteConfig {
  adapters: Map<ChainId, ChainAdapter>;   // Chain adapters to use
  feeOracle: FeeOracle;                   // Fee estimation source
  strategy: Strategy;                      // 'cheapest' | 'fastest' | 'balanced' | CustomStrategy
  maxFeeAgeMs: number;                    // Reject fees older than this (ms)
  maxFeeUsd?: bigint;                     // Max fee in USD (6-decimal bigint)
  maxFinalityMs?: number;                 // Max acceptable finality time (ms)
  excludeChains?: ChainId[];             // Chains to skip
}
```

### Fee Oracle Options

```typescript
const feeOracle = new LocalFeeOracle({
  adapters,                      // Required — chain adapters to poll
  pollIntervalMs: 30_000,       // How often to refresh fees (default: 30s)
  maxFeeAgeMs: 60_000,          // When fees become stale (required)
  fallbackAdapters: fallbacks,   // Optional — for cross-validation
  maxDivergencePercent: 50,      // Flag low confidence if primary/fallback diverge
});
```

### Constraints

```typescript
const router = createRouter({
  adapters,
  feeOracle,
  strategy: 'cheapest',
  maxFeeAgeMs: 60_000,
  maxFeeUsd: 500000n,       // Max $0.50 fee (6 decimals)
  maxFinalityMs: 5000,      // Max 5 seconds to finality
  excludeChains: ['polygon'], // Skip Polygon
});
```

---

## Supported Chains

| Chain | Adapter Package | Finality | Typical Fee (USDC transfer) | Notes |
|---|---|---|---|---|
| **Base** (L2) | `@routexcc/chain-base` | ~2s | $0.0005–$0.005 | EVM, EIP-712 signing |
| **Polygon** | `@routexcc/chain-polygon` | ~2s | $0.005–$0.05 | EVM, shared base with Base |
| **Stellar** | `@routexcc/chain-stellar` | ~5s | $0.00001–$0.0001 | Stellar consensus |
| **Solana** | `@routexcc/chain-solana` | ~400ms | $0.0005–$0.005 | SPL token transfers |

All adapters implement the `ChainAdapter` interface:

```typescript
interface ChainAdapter {
  chainId: ChainId;
  getBalance(address: string, token: string): Promise<TokenBalance>;
  estimateFee(payment: AcceptedPayment): Promise<FeeEstimate>;
  buildPaymentPayload(payment: AcceptedPayment, signer: Signer): Promise<PaymentPayload>;
  getFinality(): number;
}
```

---

## How Routing Works

Routex uses a **five-step pipeline** for every `route()` call:

```
PaymentRequirement
       |
  1. Parse         Extract candidates from accepted chains
       |
  2. Filter        Remove ineligible candidates:
       |           - Chain excluded or no adapter
       |           - Fee stale, too high, or unavailable
       |           - Insufficient balance
       |           - Finality too slow
       |
  3. Score         Apply routing strategy to remaining candidates
       |
  4. Select        Pick highest-scoring candidate, build payload
       |
  5. Verify        Enforce security invariants (recipient, amount, chain ID)
       |
   RouteResult     { chainId, payload, fee, candidates }
```

If no candidates survive filtering, Routex throws a `RouteExhaustedError` with per-candidate rejection reasons — your code can then fall back to a direct payment.

---

## Error Handling

Routex uses typed errors with full context — never silent failures.

```typescript
import {
  RouteExhaustedError,
  StaleFeesError,
  InsufficientBalanceError,
  PaymentConstructionError,
} from '@routexcc/core';

try {
  const result = await router.route(requirement, signer);
} catch (error) {
  if (error instanceof RouteExhaustedError) {
    // No chain eligible — check error.rejections for details
    console.log(error.rejections);
    // Fall back to direct payment on a specific chain
  }

  if (error instanceof InsufficientBalanceError) {
    console.log(error.chainId, error.required, error.available);
  }

  if (error instanceof StaleFeesError) {
    console.log(error.chainId, error.ageMs, error.maxAgeMs);
  }
}
```

---

## Security Model

Routex is designed around ten security invariants enforced by code and automated tests:

| # | Invariant |
|---|---|
| **INV-1** | No Routex function receives, stores, or returns a private key |
| **INV-2** | Payment recipient matches the 402 response `payTo` address |
| **INV-3** | Payment amount matches the 402 required amount (BigInt) |
| **INV-4** | Chain ID in payload matches the selected adapter's chain |
| **INV-5** | No eligible route throws `RouteExhaustedError` (never silently drops) |
| **INV-6** | Fee estimates older than `maxFeeAgeMs` are rejected |
| **INV-7** | All token arithmetic uses `bigint` — no floating-point |
| **INV-8** | Error messages never contain credentials or RPC keys |
| **INV-9** | Each `route()` call is stateless and independent |
| **INV-10** | Router failure always allows caller to fall back to direct payment |

### Non-Custodial Design

Routex interacts with your wallet through a `Signer` interface:

```typescript
interface Signer {
  sign(data: Uint8Array): Promise<Uint8Array>;
  signTypedData?(domain: object, types: object, value: object): Promise<string>;
}
```

Routex calls `.sign()` or `.signTypedData()` to construct payment payloads. It **never** accesses `.privateKey`, `.secretKey`, or `.mnemonic`. If you grep the entire codebase for these strings, you'll find zero results in source files.

---

## Packages

| Package | Description | npm |
|---|---|---|
| [`@routexcc/core`](https://www.npmjs.com/package/@routexcc/core) | Router engine, strategies, fee oracle, types | [![npm](https://img.shields.io/npm/v/@routexcc/core)](https://www.npmjs.com/package/@routexcc/core) |
| [`@routexcc/chain-base`](https://www.npmjs.com/package/@routexcc/chain-base) | Base (L2) chain adapter | [![npm](https://img.shields.io/npm/v/@routexcc/chain-base)](https://www.npmjs.com/package/@routexcc/chain-base) |
| [`@routexcc/chain-stellar`](https://www.npmjs.com/package/@routexcc/chain-stellar) | Stellar chain adapter | [![npm](https://img.shields.io/npm/v/@routexcc/chain-stellar)](https://www.npmjs.com/package/@routexcc/chain-stellar) |
| [`@routexcc/chain-solana`](https://www.npmjs.com/package/@routexcc/chain-solana) | Solana chain adapter | [![npm](https://img.shields.io/npm/v/@routexcc/chain-solana)](https://www.npmjs.com/package/@routexcc/chain-solana) |
| [`@routexcc/chain-polygon`](https://www.npmjs.com/package/@routexcc/chain-polygon) | Polygon chain adapter | [![npm](https://img.shields.io/npm/v/@routexcc/chain-polygon)](https://www.npmjs.com/package/@routexcc/chain-polygon) |
| [`@routexcc/x402`](https://www.npmjs.com/package/@routexcc/x402) | x402 middleware wrapper | [![npm](https://img.shields.io/npm/v/@routexcc/x402)](https://www.npmjs.com/package/@routexcc/x402) |
| [`@routexcc/cloud`](https://www.npmjs.com/package/@routexcc/cloud) | Cloud SDK (fee oracle, telemetry, batching) | _coming soon_ |

---

## Routex Cloud (coming soon)

Routex v1 works entirely local — zero cloud dependency. **Routex Cloud** adds an optional hosted layer:

- **Cloud Fee Oracle** — Real-time fee streaming via WebSocket. No per-agent RPC polling. Automatic fallback to local oracle if unreachable.
- **Batch Settlement** — Accumulate micropayment intents, settle in single on-chain transactions. Up to 99% cost reduction.
- **Fleet Analytics** — Dashboard with cost savings, chain distribution, and per-agent breakdowns.

All v1 code continues to work unchanged. Cloud features activate by setting a `cloudApiKey` in your config.

---

## API Reference

### `createRouter(config: RouteConfig): Router`

Creates a new router instance.

```typescript
const router = createRouter({
  adapters,
  feeOracle,
  strategy: 'cheapest',
  maxFeeAgeMs: 60_000,
});
```

### `Router.route(req: PaymentRequirement, signer: Signer): Promise<RouteResult>`

Evaluates all eligible chains and returns the best route with a signed payment payload.

```typescript
const result = await router.route(paymentRequirement, signer);
// result.chainId    — selected chain
// result.payload    — signed PaymentPayload ready for submission
// result.fee        — FeeEstimate for the selected chain
// result.candidates — all evaluated RouteOptions with scores
```

### `LocalFeeOracle`

Polls chain adapters for fee estimates. Caches results in memory with stale detection.

```typescript
const oracle = new LocalFeeOracle({ adapters, pollIntervalMs: 30_000, maxFeeAgeMs: 60_000 });
oracle.start();  // Begin polling

const fee = await oracle.getFee('base');
const allFees = await oracle.getAllFees();

oracle.stop();   // Stop polling
```

### `BalanceManager`

Queries token balances across all configured chains in parallel.

```typescript
const balances = new BalanceManager({ adapters, cacheTtlMs: 15_000 });
const balanceMap = await balances.getBalances(walletAddress, tokenAddress);
// Map<ChainId, bigint>
```

### Key Types

```typescript
type ChainId = 'base' | 'stellar' | 'solana' | 'polygon';

interface PaymentRequirement {
  acceptedChains: AcceptedPayment[];
}

interface AcceptedPayment {
  chainId: ChainId;
  payTo: string;
  amount: bigint;
  token: string;
}

interface RouteResult {
  chainId: ChainId;
  payload: PaymentPayload;
  fee: FeeEstimate;
  candidates: readonly RouteOption[];
}

interface FeeEstimate {
  feeAmount: bigint;
  feeUsd: bigint;       // 6-decimal fixed point
  finalityMs: number;
  confidence: 'high' | 'medium' | 'low';
}

interface RouteOption {
  chainId: ChainId;
  fee: FeeEstimate;
  score: number;
  eligible: boolean;
  rejectionReason?: string;
}
```

---

## Requirements

- **Node.js** >= 20
- **TypeScript** >= 5.7 (strict mode)
- Dual CJS/ESM — works with both `require()` and `import`

---

## Documentation

- [Getting Started](https://github.com/routexcc/routex/blob/main/docs/getting-started.md) — Step-by-step with Base Sepolia testnet
- [Configuration](https://github.com/routexcc/routex/blob/main/docs/configuration.md) — Every `RouteConfig` option explained
- [Strategies](https://github.com/routexcc/routex/blob/main/docs/strategies.md) — How each routing strategy scores candidates
- [Chain Adapters](https://github.com/routexcc/routex/blob/main/docs/chain-adapters.md) — Per-chain setup and RPC requirements
- [Security](https://github.com/routexcc/routex/blob/main/docs/security.md) — Fund safety guarantees and threat model
- [API Reference](https://github.com/routexcc/routex/blob/main/docs/api-reference.md) — All exported interfaces and functions

---

## Quick Start Template

Clone the starter template to build an x402 agent with Routex in minutes:

```bash
git clone https://github.com/routexcc/x402-agent-starter.git
cd x402-agent-starter
pnpm install
cp .env.example .env
pnpm server   # Terminal 1
pnpm agent    # Terminal 2
```

See [x402-agent-starter](https://github.com/routexcc/x402-agent-starter) for the full template with environment config, non-custodial signer, and local test server.

---

## Contributing

```bash
git clone https://github.com/routexcc/routex.git
cd routex
pnpm install
pnpm build
pnpm test
```

We use [changesets](https://github.com/changesets/changesets) for versioning. Run `pnpm changeset` to create a changeset before submitting a PR.

---

## License

[MIT](LICENSE)
