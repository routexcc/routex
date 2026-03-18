# Getting Started

This guide walks you through setting up Routex with a Base Sepolia testnet adapter.

## Prerequisites

- Node.js 20+
- pnpm 9+
- A Base Sepolia RPC endpoint (e.g., from Alchemy, Infura, or a public endpoint)
- A funded testnet wallet with Sepolia USDC

## Installation

```bash
pnpm add @routexcc/core @routexcc/chain-base
```

## Step 1 — Create a Chain Adapter

```typescript
import { createBaseAdapter } from '@routexcc/chain-base';
import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';

const viemClient = createPublicClient({
  chain: baseSepolia,
  transport: http('https://base-sepolia.g.alchemy.com/v2/YOUR_KEY'),
});

const baseAdapter = createBaseAdapter(viemClient, { testnet: true });
```

## Step 2 — Set Up the Fee Oracle

```typescript
import { LocalFeeOracle } from '@routexcc/core';

const adapters = new Map([['base', baseAdapter]]);

const oracle = new LocalFeeOracle({
  adapters,
  pollIntervalMs: 30_000, // Poll every 30 seconds
});

oracle.start();
```

## Step 3 — Create the Router

```typescript
import { createRouter } from '@routexcc/core';

const router = createRouter({
  adapters,
  feeOracle: oracle,
  strategy: 'cheapest',
  maxFeeAgeMs: 60_000, // Reject fee estimates older than 60s
});
```

## Step 4 — Route a Payment

When you receive a 402 Payment Required response from an x402-enabled API:

```typescript
import type { PaymentRequirement, Signer } from '@routexcc/core';

const paymentRequirement: PaymentRequirement = {
  acceptedChains: [
    {
      chainId: 'base',
      payTo: '0x1234...recipient',
      amount: 1_000_000n, // 1 USDC (6 decimals)
      token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // USDC on Base Sepolia
    },
  ],
};

// Your signer implementation (e.g., wrapping a viem WalletClient)
const signer: Signer = {
  address: '0xYourAddress',
  async sign(data) { /* your signing logic */ },
  async signTypedData(typedData) { /* your EIP-712 signing */ },
};

const result = await router.route(paymentRequirement, signer);

console.log(`Routed to ${result.chainId}`);
console.log(`Fee: ${result.fee.feeUsd} (6-decimal USD)`);
// result.payload is ready to submit to the x402 facilitator
```

## Step 5 — Use the x402 Middleware (Optional)

For automatic 402 interception:

```bash
pnpm add @routexcc/x402
```

```typescript
import { routexMiddleware } from '@routexcc/x402';

const middleware = routexMiddleware({
  routeConfig: {
    adapters,
    feeOracle: oracle,
    strategy: 'cheapest',
    maxFeeAgeMs: 60_000,
  },
  signer,
});

// In your HTTP client:
const parsed = middleware.parseResponse(response.status, response.data);
if (parsed) {
  const { payload } = await middleware.handlePaymentRequired(parsed);
  // Forward payload to facilitator
}
```

## Multi-Chain Setup

Add more chains to route across multiple networks:

```bash
pnpm add @routexcc/chain-stellar @routexcc/chain-solana @routexcc/chain-polygon
```

```typescript
import { createPolygonAdapter } from '@routexcc/chain-polygon';

const polygonAdapter = createPolygonAdapter(polygonViemClient);

const adapters = new Map([
  ['base', baseAdapter],
  ['polygon', polygonAdapter],
]);

// The router will automatically compare fees across all configured chains
```

## Error Handling

Routex uses typed errors for safe debugging:

```typescript
import { RouteExhaustedError, InsufficientBalanceError } from '@routexcc/core';

try {
  const result = await router.route(requirement, signer);
} catch (error) {
  if (error instanceof RouteExhaustedError) {
    // No eligible chain found — fall back to direct payment
    console.log('Rejections:', error.rejections);
  }
}
```

## Cleanup

Stop the oracle when your application shuts down:

```typescript
oracle.stop();
```
