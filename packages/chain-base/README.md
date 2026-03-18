# @routexcc/chain-base

Base (L2) chain adapter for Routex.

## Install

```bash
npm install @routexcc/chain-base
```

## Usage

```ts
import { createBaseAdapter } from "@routexcc/chain-base";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

const viemClient = createPublicClient({ chain: base, transport: http() });
const adapter = createBaseAdapter(viemClient);
```

## Documentation

See the [main repo README](https://github.com/routexcc/routex) for full documentation.

Part of the [Routex](https://github.com/routexcc/routex) monorepo by [Thalaxis](https://thalaxis.com).

## License

MIT
