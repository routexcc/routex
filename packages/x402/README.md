# @routexcc/x402

x402 middleware wrapper for Routex.

## Install

```bash
npm install @routexcc/x402
```

## Usage

```ts
import { routexMiddleware, handlePaymentRequired } from "@routexcc/x402";
import { createRouter } from "@routexcc/core";

const router = createRouter({ chains: [baseAdapter] });

// Express middleware
app.use(routexMiddleware({ router }));

// Or handle 402 responses directly
const response = await handlePaymentRequired(req, {
  router,
  amount: "1.00",
  currency: "USDC",
});
```

## Documentation

See the [main repo README](https://github.com/routexcc/routex) for full documentation.

Part of the [Routex](https://github.com/routexcc/routex) monorepo by [Thalaxis](https://thalaxis.com).

## License

MIT
