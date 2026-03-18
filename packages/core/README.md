# @routexcc/core

Multi-chain settlement cost router engine for the x402 payment protocol.

## Install

```bash
npm install @routexcc/core
```

## Usage

```ts
import { createRouter } from "@routexcc/core";

const router = createRouter({
  chains: [baseAdapter, polygonAdapter],
});

const route = await router.route({
  amount: "10.00",
  currency: "USDC",
});

console.log(route.chain, route.estimatedFee);
```

## Documentation

See the [main repo README](https://github.com/routexcc/routex) for full documentation.

Part of the [Routex](https://github.com/routexcc/routex) monorepo by [Thalaxis](https://thalaxis.com).

## License

MIT
