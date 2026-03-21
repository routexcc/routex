# API Reference

Complete reference for all exported interfaces, types, classes, and functions.

## Core Package (`@routexcc/core`)

### `createRouter(config: RouteConfig): Router`

Factory function that creates a Router instance.

**Parameters:**
- `config` — `RouteConfig` with adapters, oracle, strategy, and constraints.

**Returns:** A `Router` with a single `route()` method.

**Example:**
```typescript
const router = createRouter({
  adapters: new Map([['base', baseAdapter]]),
  feeOracle: oracle,
  strategy: 'cheapest',
  maxFeeAgeMs: 60_000,
});
```

---

### `Router.route(req: PaymentRequirement, signer: Signer): Promise<RouteResult>`

Select the best route and build a signed payment payload.

**Parameters:**
- `req` — Payment requirement from a 402 response.
- `signer` — Signer instance for payload construction.

**Returns:** `RouteResult` with the selected chain, payload, fee, and all evaluated options.

**Throws:**
- `RouteExhaustedError` — No eligible route found.
- `PaymentConstructionError` — Payload construction or validation failed.

---

### Types

#### `ChainId`
```typescript
type ChainId = 'base' | 'stellar' | 'solana' | 'polygon';
```

#### `RouteConfig`
```typescript
interface RouteConfig {
  readonly adapters: ReadonlyMap<ChainId, ChainAdapter>;
  readonly feeOracle: FeeOracle;
  readonly strategy: RoutingStrategy;
  readonly maxFeeAgeMs: number;
  readonly maxFeeUsd?: bigint;
  readonly maxFinalityMs?: number;
  readonly excludeChains?: readonly ChainId[];
  readonly cloudApiKey?: string;
  readonly enableBatching?: boolean;
}
```

#### `PaymentRequirement`
```typescript
interface PaymentRequirement {
  readonly acceptedChains: readonly AcceptedPayment[];
}
```

#### `AcceptedPayment`
```typescript
interface AcceptedPayment {
  readonly chainId: ChainId;
  readonly payTo: string;
  readonly amount: bigint;
  readonly token: string;
  readonly extra?: Readonly<Record<string, string>>;
}
```

#### `RouteResult`
```typescript
interface RouteResult {
  readonly chainId: ChainId;
  readonly payload: PaymentPayload;
  readonly fee: FeeEstimate;
  readonly evaluatedOptions: readonly RouteOption[];
}
```

#### `PaymentPayload`
```typescript
interface PaymentPayload {
  readonly chainId: ChainId;
  readonly to: string;
  readonly amount: bigint;
  readonly token: string;
  readonly data: string;
}
```

#### `FeeEstimate`
```typescript
interface FeeEstimate {
  readonly chainId: ChainId;
  readonly feeAmount: bigint;
  readonly feeUsd: bigint;
  readonly finalityMs: number;
  readonly confidence: FeeConfidence;
  readonly timestamp: number;
}
```

#### `FeeConfidence`
```typescript
type FeeConfidence = 'high' | 'medium' | 'low';
```

#### `RouteOption`
```typescript
interface RouteOption {
  readonly chainId: ChainId;
  readonly payment: AcceptedPayment;
  readonly fee: FeeEstimate;
  readonly balance: bigint;
  readonly score: number;
}
```

#### `TokenBalance`
```typescript
interface TokenBalance {
  readonly chainId: ChainId;
  readonly token: string;
  readonly balance: bigint;
  readonly timestamp: number;
}
```

#### `Signer`
```typescript
interface Signer {
  readonly address: string;
  sign(data: Uint8Array): Promise<Uint8Array>;
  signTypedData?(typedData: Record<string, unknown>): Promise<string>;
}
```

#### `ChainAdapter`
```typescript
interface ChainAdapter {
  readonly chainId: ChainId;
  getBalance(address: string, token: string): Promise<TokenBalance>;
  estimateFee(payment: AcceptedPayment): Promise<FeeEstimate>;
  buildPaymentPayload(payment: AcceptedPayment, signer: Signer): Promise<PaymentPayload>;
  getFinality(): number;
}
```

#### `FeeOracle`
```typescript
interface FeeOracle {
  getFee(chainId: ChainId): Promise<FeeEstimate | undefined>;
  getAllFees(): Promise<ReadonlyMap<ChainId, FeeEstimate>>;
  start(): void;
  stop(): void;
}
```

#### `RoutingStrategy`
```typescript
type RoutingStrategy = 'cheapest' | 'fastest' | 'balanced' | CustomStrategy;
```

#### `CustomStrategy`
```typescript
interface CustomStrategy {
  readonly type: 'custom';
  readonly scorer: (options: readonly RouteOption[]) => readonly RouteOption[];
}
```

#### `RejectionReason`
```typescript
interface RejectionReason {
  readonly chainId: ChainId;
  readonly reason: string;
  readonly code: RejectionCode;
}
```

#### `RejectionCode`
```typescript
type RejectionCode =
  | 'NO_ADAPTER'
  | 'INSUFFICIENT_BALANCE'
  | 'FEE_TOO_HIGH'
  | 'FINALITY_TOO_SLOW'
  | 'CHAIN_EXCLUDED'
  | 'STALE_FEE'
  | 'FEE_UNAVAILABLE';
```

---

### Error Classes

#### `RoutexError`
Abstract base class for all Routex errors.

#### `RouteExhaustedError`
Thrown when no eligible route can be found. Contains `rejections: RejectionReason[]` explaining why each chain was ineligible.

#### `StaleFeesError`
Thrown when fee estimates are older than `maxFeeAgeMs`. Contains `chainId`, `ageMs`, and `maxAgeMs`.

#### `InsufficientBalanceError`
Thrown when a chain has insufficient balance. Contains `chainId`, `required` (bigint), and `available` (bigint).

#### `PaymentConstructionError`
Thrown when payload construction fails. Contains `chainId`, `phase`, and `detail` (sanitized). Implements `toJSON()` for safe serialization.

---

### Strategy Functions

#### `cheapest(options: readonly RouteOption[]): readonly RouteOption[]`
Score by lowest fee. Formula: `1 / (feeUsd + 0.0001)`.

#### `fastest(options: readonly RouteOption[]): readonly RouteOption[]`
Score by lowest finality time. Formula: `1 / (finalityMs + 1)`.

#### `balanced(options: readonly RouteOption[]): readonly RouteOption[]`
Score by weighted combination. Formula: `0.6 * normFee + 0.4 * normFinality`.

#### `custom(scorer: CustomStrategy['scorer']): (options: readonly RouteOption[]) => readonly RouteOption[]`
Wrap a user-provided scoring function.

---

### Classes

#### `LocalFeeOracle`
Local fee oracle that polls chain adapters for fee estimates.

**Constructor:** `new LocalFeeOracle(config: LocalFeeOracleConfig)`

#### `BalanceManager`
Parallel balance query manager with caching.

**Constructor:** `new BalanceManager(config: BalanceManagerConfig)`

#### `RouteSelector`
Five-step routing pipeline (parse, filter, score, select, verify).

**Constructor:** `new RouteSelector(config: RouteConfig)`

---

## x402 Package (`@routexcc/x402`)

### `routexMiddleware(config: RoutexMiddlewareConfig): RoutexMiddleware`

Create a middleware instance for handling 402 responses.

**Parameters:**
- `config.routeConfig` — Full `RouteConfig`.
- `config.signer` — `Signer` for payload signing.
- `config.onRouteSelected?` — Callback on successful route.
- `config.onRouteFailed?` — Callback on routing failure.

**Returns:** `RoutexMiddleware` with `handlePaymentRequired()` and `parseResponse()` methods.

---

## Cloud Package (`@routexcc/cloud`)

### `CloudFeeOracle(config: CloudFeeOracleConfig): FeeOracle`

Cloud-hosted fee oracle with WebSocket streaming, REST polling fallback, and seamless degradation to a local oracle.

**Config:**
- `apiKey` — Cloud API key (`rtx_` prefix)
- `fallback` — `FeeOracle` to use when cloud is unreachable
- `endpoint?` — Oracle URL (default: `https://oracle.routex.dev`)
- `fallbackTimeoutMs?` — Milliseconds before switching to fallback (default: `5000`)
- `wsReconnectMaxMs?` — Max reconnection delay (default: `30000`)
- `restPollIntervalMs?` — REST polling interval when WS is down (default: `10000`)

**Behavior:**
1. Connects via WebSocket to `/v1/fees/stream` (primary, lowest latency)
2. Falls back to REST polling (`GET /v1/fees`) when WS reconnecting
3. If cloud unreachable for >5s, delegates to fallback `FeeOracle`
4. Recovers automatically when cloud becomes available

```typescript
import { CloudFeeOracle } from '@routexcc/cloud';
import { LocalFeeOracle } from '@routexcc/core';

const oracle = CloudFeeOracle({
  apiKey: 'rtx_your_key',
  fallback: new LocalFeeOracle(localConfig),
});
oracle.start();
```

### `TelemetryReporter(config: TelemetryReporterConfig): TelemetryReporterHandle`

Reports route telemetry to the Routex analytics backend. Extracts only allowlisted fields from `RouteResult` — no private keys, addresses, or signer info.

**Config:**
- `apiKey` — Cloud API key
- `endpoint?` — Telemetry endpoint URL
- `bufferSize?` — Events to buffer before flushing (default: `10`)
- `flushIntervalMs?` — Periodic flush interval (default: `5000`)

**Handle methods:**
- `report(result: RouteResult): void` — Queue a telemetry event (fire-and-forget)
- `flush(): Promise<void>` — Flush buffered events immediately
- `stop(): Promise<void>` — Stop and flush remaining events

**TelemetryEvent fields** (strict allowlist):
- `chainId`, `amount`, `feeUsd`, `savingsUsd`, `timestamp`

### `BatchClient(config: BatchClientConfig): { submit(result: RouteResult): Promise<void> }`

Batch settlement client (Phase 5 stub — no-op in current release).

### v2 Auto-Activation

When `cloudApiKey` is set in `RouteConfig`, `createRouter()` automatically:
- Wraps `feeOracle` with `CloudFeeOracle` (WebSocket streaming + fallback)
- Creates `TelemetryReporter` and fires `report()` after each successful route
- Falls back silently to local oracle if `@routexcc/cloud` is not installed

Zero breaking changes from v1 — all existing code works unchanged.
