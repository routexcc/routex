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

Cloud fee oracle (v1 stub — delegates to fallback).

### `TelemetryReporter(config: TelemetryReporterConfig): { report(result: RouteResult): void }`

Telemetry reporter (v1 stub — no-op).

### `BatchClient(config: BatchClientConfig): { submit(result: RouteResult): Promise<void> }`

Batch settlement client (v1 stub — no-op).
