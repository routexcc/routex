# @routexcc/chain-polygon

Polygon chain adapter for Routex.

## Install

```bash
npm install @routexcc/chain-polygon
```

## Usage

```ts
import { createPolygonAdapter } from "@routexcc/chain-polygon";
import { createPublicClient, http } from "viem";
import { polygon } from "viem/chains";

const viemClient = createPublicClient({ chain: polygon, transport: http() });
const adapter = createPolygonAdapter(viemClient);
```

## Documentation

See the [main repo README](https://github.com/routexcc/routex) for full documentation.

Part of the [Routex](https://github.com/routexcc/routex) monorepo by [Thalaxis](https://thalaxis.com).

## License

MIT
