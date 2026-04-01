# @routexcc/x402

x402 payment protocol middleware for [Routex](https://github.com/routexcc/routex) — the multi-chain settlement cost router.

## Install

```bash
npm install @routexcc/core @routexcc/x402
```

## Usage

Intercept `402 Payment Required` responses and route payments automatically:

```typescript
import { routexMiddleware } from '@routexcc/x402';

const middleware = routexMiddleware({
  routeConfig: {
    adapters,
    feeOracle,
    strategy: 'cheapest',
    maxFeeAgeMs: 60_000,
  },
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

## Exports

- `routexMiddleware(config)` — create a middleware instance
- `RoutexMiddleware` — middleware interface with `handlePaymentRequired()` and `parseResponse()`
- `RoutexMiddlewareConfig`, `ParsedX402Response`, `MiddlewareResult` — types

## Documentation

See the [full documentation](https://github.com/routexcc/routex) for routing strategies, configuration, and security model.

## License

MIT
