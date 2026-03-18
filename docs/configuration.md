# Configuration

Complete reference for `RouteConfig` and related configuration options.

## RouteConfig

The main configuration object passed to `createRouter()`.

```typescript
interface RouteConfig {
  adapters: ReadonlyMap<ChainId, ChainAdapter>;
  feeOracle: FeeOracle;
  strategy: RoutingStrategy;
  maxFeeAgeMs: number;
  maxFeeUsd?: bigint;
  maxFinalityMs?: number;
  excludeChains?: readonly ChainId[];
  cloudApiKey?: string;      // v2 — no-op in v1
  enableBatching?: boolean;  // v2 — no-op in v1
}
```

### `adapters`

**Required.** A `Map` of chain IDs to their adapter instances. Only chains with registered adapters can be routed to.

```typescript
import { createBaseAdapter } from '@routexcc/chain-base';
import { createPolygonAdapter } from '@routexcc/chain-polygon';

const adapters = new Map([
  ['base', createBaseAdapter(baseClient)],
  ['polygon', createPolygonAdapter(polygonClient)],
]);
```

### `feeOracle`

**Required.** A `FeeOracle` instance that provides fee estimates. Use `LocalFeeOracle` for local-only operation, or `CloudFeeOracle` (v2) for cloud-assisted fees.

```typescript
import { LocalFeeOracle } from '@routexcc/core';

const oracle = new LocalFeeOracle({
  adapters,
  pollIntervalMs: 30_000,
});
oracle.start();
```

### `strategy`

**Required.** The routing strategy. Built-in options:

| Strategy | Description |
|---|---|
| `'cheapest'` | Minimize fee in USD |
| `'fastest'` | Minimize time to finality |
| `'balanced'` | 60% fee weight, 40% finality weight |
| `{ type: 'custom', scorer: fn }` | Your own scoring function |

```typescript
// Built-in
const config = { strategy: 'cheapest' };

// Custom
const config = {
  strategy: {
    type: 'custom',
    scorer: (options) => options.map(o => ({
      ...o,
      score: myCustomScore(o),
    })),
  },
};
```

### `maxFeeAgeMs`

**Required.** Maximum age (in milliseconds) for fee estimates before they're considered stale and rejected. Recommended: `60_000` (60 seconds).

### `maxFeeUsd`

Optional. Maximum acceptable fee in USD, as a `bigint` with 6-decimal precision. Routes with fees above this are filtered out.

```typescript
// Reject routes costing more than $0.50
const config = { maxFeeUsd: 500_000n };
```

### `maxFinalityMs`

Optional. Maximum acceptable finality time in milliseconds. Routes slower than this are filtered out.

```typescript
// Reject routes taking longer than 10 seconds
const config = { maxFinalityMs: 10_000 };
```

### `excludeChains`

Optional. Array of chain IDs to exclude from routing.

```typescript
// Never route through Stellar
const config = { excludeChains: ['stellar'] };
```

### `cloudApiKey`

Optional (v2). Cloud API key to enable Routex Cloud features. In v1, this field is accepted but has no effect.

### `enableBatching`

Optional (v2). Enable batch settlement. Requires `cloudApiKey`. In v1, this field is accepted but has no effect.

## LocalFeeOracle Configuration

```typescript
interface LocalFeeOracleConfig {
  adapters: ReadonlyMap<ChainId, ChainAdapter>;
  pollIntervalMs?: number;   // Default: 30_000
}
```

### `pollIntervalMs`

How often to poll each chain's RPC for updated fee estimates. Lower values give fresher data but increase RPC usage.

## BalanceManager Configuration

```typescript
interface BalanceManagerConfig {
  adapters: ReadonlyMap<ChainId, ChainAdapter>;
  cacheTtlMs?: number;  // Default: 15_000
}
```

### `cacheTtlMs`

How long to cache balance queries before re-fetching. Stale balances are preferred over no balances when RPC fails.
