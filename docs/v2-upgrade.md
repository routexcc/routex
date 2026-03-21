# Upgrading to v2 (Cloud Features)

Routex v2 adds cloud-hosted fee oracle streaming, telemetry, and batch settlement. All v2 features activate when you set `cloudApiKey` in your `RouteConfig`. Zero breaking changes — all v1 code continues to work.

## 1. Install the cloud package

```bash
pnpm add @routexcc/cloud
```

## 2. Get an API key

Sign up at [cloud.routex.dev](https://cloud.routex.dev) and create an API key from the dashboard. Keys start with `rtx_`.

## 3. Add `cloudApiKey` to your config

```typescript
import { createRouter } from '@routexcc/core';

const router = createRouter({
  adapters,
  feeOracle: localOracle, // still needed as fallback
  strategy: 'cheapest',
  maxFeeAgeMs: 60000,
  cloudApiKey: 'rtx_your_api_key', // ← activates v2
});
```

That's it. The router now automatically:

1. **Wraps your fee oracle** with `CloudFeeOracle` — WebSocket streaming from the Routex oracle service, with automatic fallback to your local oracle if the cloud is unreachable for >5 seconds.

2. **Reports telemetry** after each successful `route()` call — only allowlisted fields (`chainId`, `amount`, `feeUsd`, `savingsUsd`, `timestamp`). No private keys, addresses, or signer info.

## What changes at runtime

| Aspect | v1 (no key) | v2 (with key) |
|---|---|---|
| Fee source | Local oracle polls RPCs | Cloud WebSocket (real-time), local fallback |
| Fee latency | Poll interval (30s default) | Sub-second (WebSocket push) |
| Telemetry | None | Automatic, fire-and-forget |
| Routing logic | Unchanged | Unchanged |
| Failure mode | Local oracle only | Cloud → REST poll → local (seamless) |

## Stopping the router

v2 routers have a `stop()` method to flush telemetry and close the WebSocket:

```typescript
await router.stop();
```

## Batch settlement (Phase 5)

Set `enableBatching: true` alongside `cloudApiKey` to prepare for batch settlement. This is a no-op in the current release — the `BatchClient` in `@routexcc/cloud` will be wired when the batch settlement engine is production-ready.

```typescript
const router = createRouter({
  // ...
  cloudApiKey: 'rtx_your_api_key',
  enableBatching: true, // prepares for batch settlement
});
```

## Compatibility

- Node.js 20+ required
- `@routexcc/cloud` is an optional peer dependency of `@routexcc/core`
- If `@routexcc/cloud` is not installed, `cloudApiKey` is silently ignored (v1 behavior)
- All v1 tests continue to pass without modification
