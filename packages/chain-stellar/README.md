# @routexcc/chain-stellar

Stellar chain adapter for Routex.

## Install

```bash
npm install @routexcc/chain-stellar
```

## Usage

```ts
import { createStellarAdapter } from "@routexcc/chain-stellar";
import { Horizon } from "@stellar/stellar-sdk";

const horizonClient = new Horizon.Server("https://horizon.stellar.org");
const adapter = createStellarAdapter(horizonClient);
```

## Documentation

See the [main repo README](https://github.com/routexcc/routex) for full documentation.

Part of the [Routex](https://github.com/routexcc/routex) monorepo by [Thalaxis](https://thalaxis.com).

## License

MIT
